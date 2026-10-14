// -----------------------------------------------------------------------------
// The integration itself: one Mailbox per configured account, the device and
// unread counter of each one, the scene events of the received mails, the
// connection status, and what the actions and the widget read.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice, deviceId, unreadFeatureId } from './devices.js';
import { Mailbox, testAccount } from './mailbox.js';
import { localTime, matchKeywords, messageRef } from './message.js';
import { REPORT_TEXT, STATUS_DOWN, STATUS_NO_ACCOUNT, errorText, pick } from './texts.js';

const logger = createLogger({ name: 'imap-hub' });

export const TRIGGERS = {
  MAIL_RECEIVED: 'mail_received',
  SUBJECT_KEYWORD: 'subject_keyword',
};
export const WIDGET_KEY = 'latest_mails';
// A value that does not change is published again at least this often, or
// the dashboard shows "no recent value" after 48 hours.
export const HEARTBEAT_MS = 12 * 60 * 60_000;
const HEARTBEAT_CHECK_MS = 60 * 60_000;

export class ImapHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {import('./store.js').Store} options.store
   * @param {(options: object) => object} [options.createClient] imapflow seam
   * @param {object} [options.timers] { setTimeout, clearTimeout, setInterval, clearInterval }
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, createClient, timers = globalThis, now = Date.now }) {
    this.gladys = gladys;
    this.store = store;
    this.createClient = createClient;
    this.timers = timers;
    this.now = now;
    this.config = null;
    this.mailboxes = [];
    this.data = { accounts: {} };
    this.published = new Map(); // feature external_id -> { value, at }
    this.heartbeat = null;
    this.lastStatus = null;
    this.lifecycle = Promise.resolve();
  }

  async start(config) {
    this.data = await this.store.load();
    if (!this.data.accounts || typeof this.data.accounts !== 'object') {
      this.data = { accounts: {} };
    }
    this.heartbeat = this.timers.setInterval(() => this.republishStale(), HEARTBEAT_CHECK_MS);
    await this.apply(config);
  }

  /**
   * Runs start/stop of the mailboxes one at a time: the SDK does not wait
   * for a handler before the next one, and two configuration saves in a row
   * would otherwise open two connections for one mailbox.
   */
  serial(operation) {
    const run = this.lifecycle.then(operation);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  stop() {
    return this.serial(async () => {
      if (this.heartbeat) {
        this.timers.clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
      const mailboxes = this.mailboxes;
      this.mailboxes = [];
      await Promise.all(mailboxes.map((mailbox) => mailbox.stop()));
      await this.store.flush();
    });
  }

  /** (Re)starts the mailboxes for a configuration. */
  apply(config) {
    return this.serial(() => this.restart(config));
  }

  async restart(config) {
    const previous = this.mailboxes;
    this.mailboxes = [];
    await Promise.all(previous.map((mailbox) => mailbox.stop()));
    this.config = config;
    this.published.clear();
    this.lastStatus = null;
    const state = {
      get: (id, folder) => this.data.accounts[id]?.[folder],
      set: (id, folder, value) => {
        this.data.accounts[id] = { ...this.data.accounts[id], [folder]: value };
        this.store.save(this.data);
      },
    };
    const mailboxes = config.accounts.map(
      (account) =>
        new Mailbox({
          account,
          state,
          sendSnippet: config.sendSnippet,
          checkIntervalMs: config.checkIntervalMs,
          createClient: this.createClient,
          timers: this.timers,
          onMails: (mailbox, mails) => this.onMails(mailbox, mails),
          onChange: (mailbox) => this.onChange(mailbox),
        }),
    );
    this.mailboxes = mailboxes;
    logger.info(`Watching ${mailboxes.length} mailbox(es)`);
    await this.publishDevices();
    if (mailboxes.length === 0) {
      await this.gladys.setConnectionStatus(false, STATUS_NO_ACCOUNT).catch(() => {});
      return;
    }
    await Promise.all(mailboxes.map((mailbox) => mailbox.start()));
    await this.publishStatus();
  }

  /** After a reconnection to Gladys: send again what it may have lost. */
  async resync() {
    this.published.clear();
    this.lastStatus = null;
    await this.publishDevices();
    await Promise.all(this.mailboxes.map((mailbox) => this.publishUnread(mailbox)));
    await this.publishStatus();
    this.refreshWidget();
  }

  async publishDevices() {
    const devices = this.mailboxes.map((mailbox) =>
      buildDevice(this.gladys, mailbox, this.config.language),
    );
    await this.gladys.publishDiscoveredDevices(devices);
  }

  findMailbox(deviceExternalId) {
    return this.mailboxes.find((mailbox) => deviceId(this.gladys, mailbox) === deviceExternalId);
  }

  /** Every state of a device just added in Gladys (the earlier ones were dropped). */
  async onDeviceCreated(device) {
    const mailbox = this.findMailbox(device?.external_id);
    if (!mailbox) {
      return;
    }
    this.published.delete(unreadFeatureId(this.gladys, mailbox));
    await this.publishUnread(mailbox);
    this.refreshWidget();
  }

  async publishUnread(mailbox, { force = false } = {}) {
    if (mailbox.unread === null) {
      return;
    }
    const feature = unreadFeatureId(this.gladys, mailbox);
    const last = this.published.get(feature);
    if (!force && last && last.value === mailbox.unread) {
      return;
    }
    // Recorded before the request: two changes in a row publish once.
    this.published.set(feature, { value: mailbox.unread, at: this.now() });
    try {
      await this.gladys.publishState(feature, mailbox.unread);
    } catch (err) {
      this.published.delete(feature);
      logger.debug(`Unread counter not published: ${err.message}`);
    }
  }

  async republishStale() {
    for (const mailbox of this.mailboxes) {
      const last = this.published.get(unreadFeatureId(this.gladys, mailbox));
      if (last && this.now() - last.at >= HEARTBEAT_MS) {
        await this.publishUnread(mailbox, { force: true });
      }
    }
  }

  onChange(mailbox) {
    this.publishUnread(mailbox);
    this.publishStatus();
    this.refreshWidget();
  }

  async publishStatus() {
    if (this.mailboxes.length === 0) {
      return;
    }
    const down = this.mailboxes.filter((mailbox) => mailbox.lastErrorKind !== null);
    const key = down.map((mailbox) => mailbox.account.slot).join(',');
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    const message =
      down.length === 0
        ? undefined
        : Object.fromEntries(
            Object.entries(STATUS_DOWN).map(([lang, render]) => [
              lang,
              render(down.map((mailbox) => mailbox.name).join(', ')),
            ]),
          );
    try {
      await this.gladys.setConnectionStatus(down.length === 0, message);
    } catch {
      this.lastStatus = null; // sent again on the next change or check
    }
  }

  refreshWidget() {
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch {
      // Not connected to Gladys: the widget is pulled again on mount anyway.
    }
  }

  /** New mails of one folder: one event each, plus one per keyword found. */
  async onMails(mailbox, mails) {
    const mailboxId = deviceId(this.gladys, mailbox);
    for (const mail of mails) {
      const data = {
        mailbox: mailboxId,
        mailbox_name: mailbox.name,
        folder: mail.folder,
        from_address: mail.fromAddress,
        from_domain: mail.fromDomain,
        from_name: mail.fromName,
        subject: mail.subject,
        snippet: mail.snippet,
        received_at: localTime(mail.date),
        message_ref: messageRef(mail.folder, mail.uidValidity, mail.uid),
      };
      await this.fire(TRIGGERS.MAIL_RECEIVED, data);
      for (const keyword of matchKeywords(mail.subject, this.config.keywords)) {
        await this.fire(TRIGGERS.SUBJECT_KEYWORD, { ...data, keyword: keyword.label });
      }
    }
    this.refreshWidget();
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} not delivered: ${err.message}`);
    }
  }

  // --- Actions -----------------------------------------------------------------

  /** "Test the connection": every configured account, one line each. */
  async testConnection() {
    const language = this.config.language;
    if (this.config.accounts.length === 0) {
      return errorText('no_account', language);
    }
    const results = await Promise.all(
      this.config.accounts.map(async (account) => ({
        account,
        result: await testAccount(account, this.createClient),
      })),
    );
    const report = pick(REPORT_TEXT, language);
    const lines = results.map(({ account, result }) => {
      if (!result.ok) {
        return report.failed(account.slot, errorText(result.kind, language));
      }
      const line = report.ok(account.slot, result.unread);
      return result.missing.length > 0
        ? `${line} ${report.missing(result.missing.join(', '))}`
        : line;
    });
    logger.info(`Connection test: ${results.filter(({ result }) => result.ok).length} OK`);
    return lines.join(' ');
  }

  mailboxFor(deviceExternalId) {
    const mailbox =
      this.findMailbox(deviceExternalId) ??
      (!deviceExternalId && this.mailboxes.length === 1 ? this.mailboxes[0] : undefined);
    if (!mailbox) {
      const err = new Error(errorText('unknown_mailbox', this.config.language));
      err.kind = 'unknown_mailbox';
      throw err;
    }
    return mailbox;
  }

  /** Scene action: the live unread counter of one mailbox. */
  async readUnread(deviceExternalId) {
    const mailbox = this.mailboxFor(deviceExternalId);
    try {
      return await mailbox.readUnread();
    } catch (err) {
      throw new Error(errorText(err, this.config.language), { cause: err });
    }
  }

  /** Scene action: flags one mail (given by its reference) as read. */
  async markAsRead(deviceExternalId, ref) {
    const mailbox = this.mailboxFor(deviceExternalId);
    if (!ref) {
      throw new Error(errorText('invalid_ref', this.config.language));
    }
    try {
      const done = await mailbox.markAsRead(ref);
      logger.info(`Mail marked as read in ${mailbox.label}`);
      return done;
    } catch (err) {
      throw new Error(errorText(err, this.config.language), { cause: err });
    }
  }
}
