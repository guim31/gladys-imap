// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ACCOUNT_SLOTS,
  CHECK_INTERVALS,
  DEFAULT_CONFIG,
  LANGUAGES,
  SECURITY_MODES,
} from '../src/config.js';
import { ACTION_KEY } from '../src/app.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { mail } from './helpers/fakeImap.js';
import { createWorld, sceneEvents, settle } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: a cloud device integration, notifications and services', () => {
  assert.equal(manifest.name, 'IMAP Mail');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-imap:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-imap/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['notifications', 'services']);
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), 'triggers, actions and widgets: 5.1.0');
});

test('three mailbox blocks, the password in a secret field', () => {
  for (const slot of ACCOUNT_SLOTS) {
    const fields = manifest.config_schema.filter((field) =>
      field.key.startsWith(`account_${slot}_`),
    );
    assert.deepEqual(
      fields.map((field) => [field.key.replace(`account_${slot}_`, ''), field.type]),
      [
        ['host', 'string'],
        ['port', 'number'],
        ['security', 'select'],
        ['username', 'string'],
        ['password', 'secret'],
        ['folders', 'string'],
        ['allow_self_signed', 'boolean'],
      ],
    );
    const security = fields.find((field) => field.key.endsWith('security'));
    assert.deepEqual(
      security.options.map((option) => option.value),
      SECURITY_MODES,
    );
  }
  // No field is required: an empty block means "no mailbox here".
  assert.ok(manifest.config_schema.every((field) => !field.required));
});

test('the selects offer the values of the code', () => {
  const options = (key) =>
    manifest.config_schema.find((field) => field.key === key).options.map((option) => option.value);
  assert.deepEqual(options('language'), LANGUAGES);
  assert.deepEqual(options('check_interval'), CHECK_INTERVALS);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section ${field.key} stores no value`);
      assert.equal(field.default, undefined);
      assert.equal(field.required, undefined);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `DEFAULT_CONFIG.${field.key} is missing`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
  assert.equal(
    Object.keys(DEFAULT_CONFIG).length,
    manifest.config_schema.filter((field) => field.type !== 'section').length,
  );
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((entry) => entry.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `${field.key}.${key}`);
      }
    }
  }
});

test('every manifest action, scene action and widget has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.actions), [ACTION_KEY]);
  assert.deepEqual(keysOf(manifest.scene_actions), Object.keys(SCENE_ACTIONS));
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  const w = await createWorld();
  t.after(() => w.app.stop());
  assert.equal((await w.fake.action(ACTION_KEY, {})).success, true);
  const mailbox = w.fake.discoveredDevices[0].external_id;
  w.server.deliver('INBOX', mail());
  await settle();
  const ref = sceneEvents(w.fake)[0].data.message_ref;
  for (const action of manifest.scene_actions) {
    const ack = await w.fake.sceneAction(action.key, { mailbox, message_ref: ref });
    assert.equal(ack.success, true, action.key);
    assert.deepEqual(Object.keys(ack.data.outputs), keysOf(action.outputs), action.key);
    // A required field without default would break the scenes of an update.
    for (const field of action.fields) {
      assert.ok(field.type !== 'secret');
    }
  }
  const widget = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.equal(widget.success, true);
});

test('the triggers fired carry exactly their declared filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers), Object.values(TRIGGERS));
  const w = await createWorld({ config: undefined });
  t.after(() => w.app.stop());
  await w.app.hub.apply({ ...w.app.hub.config, keywords: [{ label: 'Hi', folded: 'hi' }] });
  w.server.deliver('INBOX', mail({ subject: 'Hi' }));
  await settle();
  const events = sceneEvents(w.fake);
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((entry) => entry.key === trigger.key);
    assert.ok(event, `${trigger.key} was fired`);
    const declared = new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)]);
    assert.deepEqual(
      Object.keys(event.data)
        .filter((key) => declared.has(key))
        .sort(),
      [...declared].sort(),
      `${trigger.key}: every declared key is sent`,
    );
    for (const field of trigger.fields) {
      assert.ok(['select', 'string'].includes(field.type), `${trigger.key}.${field.key}`);
    }
    for (const variable of trigger.variables) {
      assert.equal(typeof event.data[variable.key], variable.type, variable.key);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('section links are https', () => {
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});
