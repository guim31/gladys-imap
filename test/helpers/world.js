// -----------------------------------------------------------------------------
// Test world: the SDK's fake Gladys, the real handlers (src/app.js), the
// in-memory IMAP server, an in-memory store and manual timers.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { FakeImapServer, HOST, PASSWORD, USER } from './fakeImap.js';

export const ACCOUNT_1 = {
  account_1_host: HOST,
  account_1_username: USER,
  account_1_password: PASSWORD,
};

export class MemoryStore {
  constructor(data = {}) {
    this.data = structuredClone(data);
    this.saves = 0;
  }

  async load() {
    return structuredClone(this.data);
  }

  save(data) {
    this.data = structuredClone(data);
    this.saves += 1;
    return Promise.resolve();
  }

  flush() {
    return Promise.resolve();
  }
}

/** Timers run by hand: `advance(ms)` fires what is due, in order. */
export function createClock(start = Date.parse('2026-10-14T08:00:00Z')) {
  let now = start;
  let nextId = 1;
  const pending = new Map();
  const schedule = (fn, delay, interval) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { fn, at: now + delay, interval });
    return id;
  };
  const clock = {
    now: () => now,
    timers: {
      setTimeout: (fn, delay = 0) => schedule(fn, delay, null),
      clearTimeout: (id) => pending.delete(id),
      setInterval: (fn, delay) => schedule(fn, delay, delay),
      clearInterval: (id) => pending.delete(id),
    },
    pending: () => [...pending.values()].map((timer) => timer.at - now),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) {
          break;
        }
        const [id, timer] = due;
        now = timer.at;
        if (timer.interval) {
          timer.at += timer.interval;
        } else {
          pending.delete(id);
        }
        timer.fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
  return clock;
}

/** Lets the pending promise chains run. */
export async function settle() {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options]
 * @param {object} [options.config] integration config (account 1 by default)
 * @param {FakeImapServer} [options.server]
 * @param {MemoryStore} [options.store]
 */
export async function createWorld({
  config = ACCOUNT_1,
  server = new FakeImapServer(),
  store = new MemoryStore(),
  clock = createClock(),
  devices = [],
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store,
    createClient: server.createClient,
    timers: clock.timers,
    now: clock.now,
  });
  await gladys.connect();
  await app.ready;
  await settle();
  return { gladys, fake: gladys.fake, app, hub: app.hub, server, store, clock };
}

/** The scene events fired, as { key, data }. */
export function sceneEvents(fake) {
  return fake.sceneEvents.map((event) => ({ key: event.key, data: event.data }));
}
