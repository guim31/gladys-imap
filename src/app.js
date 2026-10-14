// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { ImapHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'imap-app' });

export const ACTION_KEY = 'test_connection';

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, createClient, timers, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new ImapHub({
    gladys,
    store: options.store ?? new Store(),
    createClient: options.createClient,
    timers: options.timers,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      if (started) {
        // A reconnection (Gladys restarted): the mailboxes kept running, send
        // again what Gladys may have lost.
        await hub.resync();
        return;
      }
      started = true;
      await hub.start(normalizeConfig(await gladys.getConfig()));
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.publishDevices()));

  // The devices are published with should_poll: false (IDLE and the periodic
  // check push the counters); this only serves a Gladys that would poll anyway.
  gladys.onPoll(
    whenReady(async (device) => {
      const mailbox = hub.findMailbox(device.external_id);
      if (mailbox) {
        await hub.publishUnread(mailbox);
      }
    }),
  );

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.apply(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    ACTION_KEY,
    whenReady(() => hub.testConnection()),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
