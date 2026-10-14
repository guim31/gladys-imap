import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FakeImapServer, HOST, USER, mail } from './helpers/fakeImap.js';
import { ACCOUNT_1, createWorld, settle } from './helpers/world.js';

async function content(w, settings = {}, language = 'fr') {
  const ack = await w.fake.widgetGet('latest_mails', { settings, language });
  assert.equal(ack.success, true);
  const tree = ack.data.content;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

test('the widget lists the last mails, newest first, never the body', async (t) => {
  const server = new FakeImapServer();
  server.deliver(
    'INBOX',
    Array.from({ length: 10 }, (_, i) =>
      mail({
        subject: `Mail ${i}`,
        text: 'SECRET BODY',
        date: new Date(Date.UTC(2026, 9, 14, 8, i)),
      }),
    ),
  );
  const w = await createWorld({ server });
  t.after(() => w.app.stop());
  server.deliver('INBOX', mail({ subject: '', date: new Date('2026-10-14T09:00:00Z') }));
  await settle();

  const [device] = w.fake.discoveredDevices;
  const tree = await content(w, { mailbox: device.external_id });
  assert.deepEqual(tree.components[0], {
    type: 'value',
    label: 'Non lus',
    icon: 'mail',
    device_feature: device.features[0].external_id,
  });
  const list = tree.components[1];
  assert.equal(list.type, 'card-list');
  assert.equal(list.items.length, 8);
  assert.deepEqual(list.items[0], {
    title: '(sans objet)',
    subtitle: 'Alerts',
    date: '2026-10-14T09:00:00.000Z',
  });
  assert.equal(list.items[1].title, 'Mail 9');
  assert.ok(!JSON.stringify(tree).includes('SECRET'));
});

test('without a chosen mailbox: every mailbox, the total of the counters', async (t) => {
  const server = new FakeImapServer({ users: { [USER]: ACCOUNT_1.account_1_password, bob: 'b' } });
  const w = await createWorld({
    server,
    config: {
      ...ACCOUNT_1,
      account_2_host: HOST,
      account_2_username: 'bob',
      account_2_password: 'b',
    },
  });
  t.after(() => w.app.stop());
  server.deliver('INBOX', [mail({ from: 'Ann <ann@example.net>' })]);
  await settle();
  const tree = await content(w, {}, 'en');
  // Both accounts read the same fake INBOX: one unread mail each.
  assert.equal(tree.components[0].value, 2);
  assert.match(tree.components[1].items[0].subtitle, /^Ann · /);
});

test('an empty mailbox and an unavailable one say so', async (t) => {
  const w = await createWorld({
    config: {
      ...ACCOUNT_1,
      account_2_host: HOST,
      account_2_username: 'x',
      account_2_password: 'y',
    },
  });
  t.after(() => w.app.stop());
  const tree = await content(w, {}, 'de');
  const types = tree.components.map((component) => component.type);
  assert.deepEqual(types, ['value', 'text', 'status']);
  assert.match(tree.components[1].text, /keine E-Mail/);
  assert.deepEqual(tree.components[2].items, [
    { label: `x@${HOST}`, value: 'Mailserver nicht erreichbar', color: 'danger' },
  ]);
});
