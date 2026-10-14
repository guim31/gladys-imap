// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// configurations: one to three mailboxes, in every feature-name language,
// before and after the first mails.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeImapServer, HOST, PASSWORD, USER, mail } from './helpers/fakeImap.js';
import { ACCOUNT_1, createWorld, settle } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const threeAccounts = {
  ...ACCOUNT_1,
  account_2_host: HOST,
  account_2_username: 'bob',
  account_2_password: 'b',
  account_3_host: 'imap.example.org',
  account_3_username: USER,
  account_3_password: PASSWORD,
  account_3_folders: 'INBOX, Alerts',
};

const scenarios = [
  { label: 'one mailbox', config: ACCOUNT_1, count: 1 },
  { label: 'three mailboxes', config: threeAccounts, count: 3 },
  { label: 'English names', config: { ...threeAccounts, language: 'en' }, count: 3 },
  { label: 'German names', config: { ...threeAccounts, language: 'de' }, count: 3 },
  { label: 'Spanish names', config: { ...threeAccounts, language: 'es' }, count: 3 },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const server = new FakeImapServer({
      folders: ['INBOX', 'Alerts'],
      users: { [USER]: PASSWORD, bob: 'b' },
    });
    server.deliver('INBOX', [mail(), mail({ seen: true })]);
    const { gladys, app } = await createWorld({ config: scenario.config, server });
    try {
      server.deliver('INBOX', mail());
      await settle();
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, scenario.count);
      assert.equal(new Set(devices.map((device) => device.external_id)).size, scenario.count);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the server fits the declared bounds.
          const value = gladys.fake.lastState(feature.external_id);
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
    } finally {
      await app.stop();
    }
  });
}

test('the external ids follow the account, not the slot it was typed in', async () => {
  const a = await createWorld({ config: ACCOUNT_1 });
  const moved = {
    account_2_host: ACCOUNT_1.account_1_host.toUpperCase(),
    account_2_username: ACCOUNT_1.account_1_username,
    account_2_password: ACCOUNT_1.account_1_password,
  };
  const b = await createWorld({ config: moved });
  try {
    assert.equal(a.fake.discoveredDevices[0].external_id, b.fake.discoveredDevices[0].external_id);
    assert.match(
      a.fake.discoveredDevices[0].external_id,
      /^ext:test-integration:mailbox:[0-9a-f]{16}$/,
    );
  } finally {
    await a.app.stop();
    await b.app.stop();
  }
});
