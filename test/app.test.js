// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the in-memory
// IMAP server: baseline, real-time mails, other folders, catch-up after a
// restart, reconnection, scene actions, connection test.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_RETRY_MS, MAX_CATCHUP, RETRY_DELAYS_MS } from '../src/mailbox.js';
import { HEARTBEAT_MS } from '../src/hub.js';
import { FakeImapServer, HOST, USER, mail } from './helpers/fakeImap.js';
import { ACCOUNT_1, MemoryStore, createWorld, sceneEvents, settle } from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const unreadFeature = (w) => w.fake.discoveredDevices[0].features[0].external_id;

test('the first start takes a baseline: the mails already there fire nothing', async (t) => {
  const server = new FakeImapServer();
  server.deliver('INBOX', [mail({ subject: 'old 1' }), mail({ subject: 'old 2', seen: true })]);
  const w = await world(t, { server });
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(w.fake.lastState(unreadFeature(w)), 1);
  assert.deepEqual(w.fake.connectionStatuses.at(-1), { connected: true });
  assert.deepEqual(w.store.data.accounts[w.hub.mailboxes[0].id], {
    INBOX: { uidValidity: '1000', lastUid: 2 },
  });
  // The widget shows the last mails already there.
  assert.deepEqual(
    w.hub.mailboxes[0].recent.map((recent) => recent.subject),
    ['old 1', 'old 2'],
  );
});

test('a new mail fires "Mail received" with its details, in real time', async (t) => {
  const w = await world(t, { config: { ...ACCOUNT_1, subject_keywords: 'facture, Colis' } });
  w.server.deliver(
    'INBOX',
    mail({
      from: 'EDF <Factures@EDF.example>',
      subject: 'Votre facture et votre colis',
      text: 'Bonjour,\n\nVotre facture est disponible.\n> old',
      date: new Date('2026-10-14T08:05:00Z'),
    }),
  );
  await settle();
  const events = sceneEvents(w.fake);
  assert.deepEqual(
    events.map((event) => [event.key, event.data.keyword ?? null]),
    [
      ['mail_received', null],
      ['subject_keyword', 'facture'],
      ['subject_keyword', 'Colis'],
    ],
  );
  const { data } = events[0];
  assert.equal(data.mailbox, w.fake.discoveredDevices[0].external_id);
  assert.equal(data.mailbox_name, USER);
  assert.equal(data.folder, 'INBOX');
  assert.equal(data.from_address, 'factures@edf.example');
  assert.equal(data.from_domain, 'edf.example');
  assert.equal(data.from_name, 'EDF');
  assert.equal(data.subject, 'Votre facture et votre colis');
  assert.equal(data.snippet, 'Bonjour, Votre facture est disponible.');
  assert.match(data.received_at, /^2026-10-14 \d\d:05$/);
  assert.equal(data.message_ref, '1000:1:INBOX');
  // The counter follows at once.
  assert.equal(w.fake.lastState(unreadFeature(w)), 1);
  assert.equal(w.server.downloads[0].maxBytes, 4096);
});

test('a check never marks a mail as read, and the extract can be switched off', async (t) => {
  const w = await world(t, { config: { ...ACCOUNT_1, send_snippet: false } });
  w.server.deliver('INBOX', [mail(), mail({ html: '<p>x</p>' })]);
  await settle();
  await w.clock.advance(10 * 60_000);
  assert.equal(sceneEvents(w.fake).length, 2);
  assert.ok(sceneEvents(w.fake).every((event) => event.data.snippet === ''));
  assert.deepEqual(w.server.downloads, []);
  assert.deepEqual(w.server.flagChanges, []);
  assert.equal(w.fake.lastState(unreadFeature(w)), 2);
});

test('the other folders are read by the periodic check', async (t) => {
  const server = new FakeImapServer({ folders: ['INBOX', 'Alerts'] });
  const w = await world(t, {
    server,
    config: { ...ACCOUNT_1, account_1_folders: 'INBOX, Alerts', check_interval: '5' },
  });
  server.deliver('Alerts', mail({ subject: 'Disk full' }));
  await settle();
  assert.deepEqual(w.fake.sceneEvents, [], 'IDLE runs on the first folder only');
  await w.clock.advance(5 * 60_000);
  assert.deepEqual(
    sceneEvents(w.fake).map((event) => [event.data.folder, event.data.subject]),
    [['Alerts', 'Disk full']],
  );
  assert.equal(w.fake.lastState(unreadFeature(w)), 1);
  // IDLE is back on the first folder.
  assert.equal(server.openClients[0].mailbox.path, 'INBOX');
});

test('a missing folder is skipped, the others are watched', async (t) => {
  const w = await world(t, { config: { ...ACCOUNT_1, account_1_folders: 'INBOX, Nope' } });
  assert.deepEqual(w.fake.connectionStatuses.at(-1), { connected: true });
  w.server.deliver('INBOX', mail());
  await settle();
  assert.equal(sceneEvents(w.fake).length, 1);
});

test('after a restart, the mails received meanwhile fire, the oldest beyond 20 do not', async (t) => {
  const server = new FakeImapServer();
  const store = new MemoryStore();
  const first = await createWorld({ server, store });
  server.deliver('INBOX', mail({ subject: 'seen live' }));
  await settle();
  await first.app.stop();

  server.deliver(
    'INBOX',
    Array.from({ length: MAX_CATCHUP + 5 }, (_, i) => mail({ subject: `away ${i}` })),
    { notify: false },
  );
  const w = await world(t, { server, store });
  const subjects = sceneEvents(w.fake).map((event) => event.data.subject);
  assert.equal(subjects.length, MAX_CATCHUP);
  assert.equal(subjects[0], 'away 5');
  assert.equal(subjects.at(-1), `away ${MAX_CATCHUP + 4}`);
});

test('a folder rebuilt by the server (new UIDVALIDITY) takes a new baseline', async (t) => {
  const server = new FakeImapServer();
  const store = new MemoryStore();
  const first = await createWorld({ server, store });
  server.deliver('INBOX', [mail(), mail()]);
  await settle();
  await first.app.stop();
  server.rebuild('INBOX');
  const w = await world(t, { server, store });
  assert.deepEqual(w.fake.sceneEvents, []);
  server.deliver('INBOX', mail({ subject: 'after rebuild' }));
  await settle();
  assert.deepEqual(
    sceneEvents(w.fake).map((event) => event.data.message_ref),
    ['1100:3:INBOX'],
  );
});

test('a lost connection comes back with a growing delay', async (t) => {
  const w = await world(t);
  w.server.down = true;
  w.server.dropConnections();
  await settle();
  const [mailbox] = w.hub.mailboxes;
  assert.equal(mailbox.lastErrorKind, 'network');
  assert.equal(w.fake.connectionStatuses.at(-1).connected, false);
  assert.match(w.fake.connectionStatuses.at(-1).message.fr, /alice@example\.com/);

  const before = w.server.connections;
  await w.clock.advance(RETRY_DELAYS_MS[0]);
  await w.clock.advance(RETRY_DELAYS_MS[1] - 1);
  assert.equal(w.server.connections, before + 1, 'the second retry waits longer');
  w.server.down = false;
  w.server.deliver('INBOX', mail({ subject: 'while down' }), { notify: false });
  await w.clock.advance(1);
  assert.equal(mailbox.lastErrorKind, null);
  assert.deepEqual(w.fake.connectionStatuses.at(-1), { connected: true });
  assert.deepEqual(
    sceneEvents(w.fake).map((event) => event.data.subject),
    ['while down'],
  );
});

test('a refused password retries after 30 minutes only', async (t) => {
  const w = await world(t, { config: { ...ACCOUNT_1, account_1_password: 'wrong' } });
  const [mailbox] = w.hub.mailboxes;
  assert.equal(mailbox.lastErrorKind, 'auth');
  assert.equal(w.fake.connectionStatuses.at(-1).connected, false);
  const before = w.server.connections;
  await w.clock.advance(AUTH_RETRY_MS - 1);
  assert.equal(w.server.connections, before);
  await w.clock.advance(1);
  assert.equal(w.server.connections, before + 1);
});

test('"Mark as read" flags only the mail of the trigger, and checks UIDVALIDITY', async (t) => {
  const w = await world(t);
  w.server.deliver('INBOX', [mail(), mail()]);
  await settle();
  const [first] = sceneEvents(w.fake);
  const mailbox = first.data.mailbox;
  const ack = await w.fake.sceneAction('mark_as_read', {
    mailbox,
    message_ref: first.data.message_ref,
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { marked: true } } });
  assert.deepEqual(w.server.flagChanges, [{ folder: 'INBOX', uid: 1, flags: ['\\Seen'] }]);
  assert.equal(w.fake.lastState(unreadFeature(w)), 1);

  const stale = await w.fake.sceneAction('mark_as_read', {
    mailbox,
    message_ref: '999:2:INBOX',
  });
  assert.equal(stale.success, false);
  assert.match(stale.error, /n'existe plus/);
  const unwatched = await w.fake.sceneAction('mark_as_read', {
    mailbox,
    message_ref: '1000:2:Archive',
  });
  assert.match(unwatched.error, /dossier introuvable/);
  const invalid = await w.fake.sceneAction('mark_as_read', { mailbox, message_ref: 'x' });
  assert.match(invalid.error, /Référence du mail/);
  assert.equal(w.server.flagChanges.length, 1);
});

test('"Read the unread count" asks the server', async (t) => {
  const w = await world(t);
  w.server.deliver('INBOX', [mail(), mail(), mail({ seen: true })], { notify: false });
  const ack = await w.fake.sceneAction('get_unread_count', {
    mailbox: w.fake.discoveredDevices[0].external_id,
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { unread: 2 } } });
  const unknown = await w.fake.sceneAction('get_unread_count', { mailbox: 'ext:x:mailbox:y' });
  assert.match(unknown.error, /n'est plus dans la configuration/);
});

test('"Test the connection" reports each mailbox in the configured language', async (t) => {
  const w = await world(t, {
    config: {
      ...ACCOUNT_1,
      account_1_folders: 'INBOX, Nope',
      account_2_host: HOST,
      account_2_username: 'bob',
      account_2_password: 'wrong',
      language: 'en',
    },
  });
  w.server.deliver('INBOX', mail(), { notify: false });
  const ack = await w.fake.action('test_connection', {});
  assert.equal(
    ack.data.message,
    'Mailbox 1: OK, 1 unread. Folders not found: Nope. Mailbox 2: login refused: check the user and the (app) password.',
  );
  assert.ok(ack.data.message.length <= 200);
  assert.equal(w.server.openClients.length, 1, 'the test logged out');

  const empty = await world(t, { config: {} });
  assert.match((await empty.fake.action('test_connection', {})).data.message, /aucune boîte/);
  assert.deepEqual(empty.fake.discoveredDevices, []);
  assert.equal(empty.fake.connectionStatuses.at(-1).connected, false);
});

test('a device added in Gladys gets its counter again, and the heartbeat every 12 h', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  const count = () => w.fake.states.length;
  const before = count();
  await w.fake.deviceCreated({ ...device, id: 'uuid' });
  assert.equal(count(), before + 1);
  assert.ok(w.fake.widgetRefreshes.length > 0);
  await w.clock.advance(HEARTBEAT_MS - 60 * 60_000);
  assert.equal(count(), before + 1);
  await w.clock.advance(60 * 60_000);
  assert.equal(count(), before + 2);
});

test('a new configuration restarts the mailboxes', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...ACCOUNT_1, language: 'de' });
  await settle();
  assert.equal(w.server.openClients.length, 1);
  assert.equal(w.fake.discoveredDevices[0].features[0].name, 'Ungelesene E-Mails');
  w.server.deliver('INBOX', mail());
  await settle();
  assert.equal(sceneEvents(w.fake).length, 1);
});

test('a reconnection to Gladys publishes devices, counter and status again', async (t) => {
  const w = await world(t);
  const states = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await settle();
  assert.equal(w.fake.states.length, states + 1);
  assert.deepEqual(w.fake.connectionStatuses.at(-1), { connected: true });
  assert.equal(w.server.openClients.length, 1, 'the IMAP connection is kept');
});

// --- Regressions found by the review ------------------------------------------

test('after outages, the periodic check runs once per interval, not once per outage', async (t) => {
  const w = await world(t, { config: { ...ACCOUNT_1, check_interval: '1' } });
  for (let i = 0; i < 3; i += 1) {
    w.server.down = true;
    w.server.dropConnections();
    await settle();
    w.server.down = false;
    await w.clock.advance(RETRY_DELAYS_MS[0]);
  }
  const before = w.server.searches;
  await w.clock.advance(3 * 60_000);
  assert.equal(w.server.searches - before, 3);
});

test('two configuration saves in a row leave one connection per mailbox', async (t) => {
  const w = await world(t);
  await Promise.all([
    w.fake.configUpdated({ ...ACCOUNT_1, language: 'en' }),
    w.fake.configUpdated({ ...ACCOUNT_1, language: 'de' }),
  ]);
  await settle();
  assert.equal(w.server.openClients.length, 1);
  assert.equal(w.hub.mailboxes.length, 1);
});

test('while reconnecting, the unread count is an error, never 0', async (t) => {
  const w = await world(t);
  w.server.deliver('INBOX', mail(), { notify: false });
  await w.clock.advance(2 * 60_000);
  assert.equal(w.fake.lastState(unreadFeature(w)), 1);
  w.server.down = true;
  w.server.dropConnections();
  await settle();
  const ack = await w.fake.sceneAction('get_unread_count', {
    mailbox: w.fake.discoveredDevices[0].external_id,
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /ne répond pas/);
  assert.equal(w.fake.lastState(unreadFeature(w)), 1);
});

test('a server prefixing the folders ("INBOX.Alerts") fires each mail once', async (t) => {
  const server = new FakeImapServer({ folders: ['INBOX', 'Alerts'], prefix: 'INBOX.' });
  const w = await world(t, {
    server,
    config: { ...ACCOUNT_1, account_1_folders: 'Alerts, INBOX' },
  });
  server.deliver('Alerts', mail({ subject: 'real time' }));
  await settle();
  await w.clock.advance(4 * 60_000);
  const events = sceneEvents(w.fake);
  assert.deepEqual(
    events.map((event) => [event.data.folder, event.data.subject]),
    [['Alerts', 'real time']],
  );
  const ack = await w.fake.sceneAction('mark_as_read', {
    mailbox: events[0].data.mailbox,
    message_ref: events[0].data.message_ref,
  });
  assert.equal(ack.success, true);
});

test('only the newest mails are fetched after a bulk arrival', async (t) => {
  const w = await world(t);
  w.server.deliver(
    'INBOX',
    Array.from({ length: 500 }, (_, i) => mail({ subject: `bulk ${i}` })),
    { notify: false },
  );
  w.server.downloads.length = 0;
  await w.clock.advance(2 * 60_000);
  assert.equal(sceneEvents(w.fake).length, MAX_CATCHUP);
  assert.equal(w.server.downloads.length, MAX_CATCHUP);
});
