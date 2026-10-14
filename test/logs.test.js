// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A received mail, a check, a counter write nothing; a failure that
// repeats is logged once, and its end once. Never a password, and the sender
// and subject only at debug level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETRY_DELAYS_MS } from '../src/mailbox.js';
import { PASSWORD, mail } from './helpers/fakeImap.js';
import { createWorld, settle } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record = (...args) =>
    lines.push(args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return { lines, clear: () => lines.splice(0) };
}

test('a normal day writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await createWorld({ config: undefined });
  t.after(() => w.app.stop());
  assert.ok(
    logs.lines.some((line) => line.includes('connected')),
    'the start is logged',
  );
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.server.deliver('INBOX', mail({ subject: `Private subject ${i}` }));
    await settle();
    await w.clock.advance(2 * 60_000);
  }
  assert.equal(w.fake.sceneEvents.length, 5);
  assert.deepEqual(logs.lines, []);
});

test('an outage is logged once, its end once', async (t) => {
  const logs = captureLogs(t);
  const w = await createWorld();
  t.after(() => w.app.stop());
  logs.clear();
  w.server.down = true;
  w.server.dropConnections();
  await settle();
  for (const delay of RETRY_DELAYS_MS) {
    await w.clock.advance(delay);
  }
  assert.equal(logs.lines.length, 1);
  assert.match(logs.lines[0], /unavailable \(network\)/);
  w.server.down = false;
  await w.clock.advance(RETRY_DELAYS_MS.at(-1));
  assert.equal(logs.lines.length, 2);
  assert.match(logs.lines[1], /connected again/);
});

test('even at debug level, the password never appears', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.server.deliver('INBOX', mail({ subject: 'Hello' }));
  await settle();
  await w.fake.action('test_connection', {});
  await w.fake.configUpdated({
    account_1_host: 'imap.example.com',
    account_1_username: 'alice@example.com',
    account_1_password: 'wrong password',
  });
  await settle();
  const all = logs.lines.join('\n');
  assert.ok(all.includes('alerts@example.net'), 'the sender is logged at debug level');
  assert.ok(!all.includes(PASSWORD));
  assert.ok(!all.includes('wrong password'));
});
