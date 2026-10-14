import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_FOLDERS,
  fold,
  normalizeConfig,
  parseFolders,
  parseKeywords,
} from '../src/config.js';

test('an empty configuration watches nothing, with the defaults', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, {
    accounts: [],
    keywords: [],
    sendSnippet: true,
    checkIntervalMs: 120_000,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(null), config);
  assert.equal(DEFAULT_CONFIG.account_2_port, 993);
});

test('an account counts only with server, user and password', () => {
  const config = normalizeConfig({
    account_1_host: 'imap.example.com',
    account_1_username: 'alice@example.com',
    account_2_host: 'imap.example.org',
    account_2_username: 'bob',
    account_2_password: ' pass ',
    account_2_security: 'starttls',
    account_2_port: '',
    account_3_host: '  imaps://Mail.Example.net:993/ ',
    account_3_username: 'carol',
    account_3_password: 'x',
    account_3_port: '1993',
    account_3_folders: ' inbox , Alerts,alerts, Alerts ',
    account_3_allow_self_signed: true,
  });
  assert.deepEqual(config.accounts, [
    {
      slot: 2,
      host: 'imap.example.org',
      port: 143,
      security: 'starttls',
      username: 'bob',
      password: ' pass ',
      folders: ['INBOX'],
      allowSelfSigned: false,
    },
    {
      slot: 3,
      host: 'mail.example.net',
      port: 1993,
      security: 'tls',
      username: 'carol',
      password: 'x',
      folders: ['INBOX', 'Alerts', 'alerts'],
      allowSelfSigned: true,
    },
  ]);
});

test('folders: comma-separated, INBOX by default, bounded', () => {
  assert.deepEqual(parseFolders(''), ['INBOX']);
  assert.deepEqual(parseFolders(undefined), ['INBOX']);
  assert.deepEqual(parseFolders('Inbox,,Work/Alerts'), ['INBOX', 'Work/Alerts']);
  const many = Array.from({ length: 9 }, (_, i) => `F${i}`).join(',');
  assert.equal(parseFolders(many).length, MAX_FOLDERS);
});

test('keywords: compared without case or accents, emitted as typed', () => {
  assert.equal(fold('  Électricité  ÉTÉ '), 'electricite ete');
  assert.deepEqual(parseKeywords('Facture, colis , FACTURE,, Livré'), [
    { label: 'Facture', folded: 'facture' },
    { label: 'colis', folded: 'colis' },
    { label: 'Livré', folded: 'livre' },
  ]);
});

test('options: unknown values fall back to the defaults', () => {
  const config = normalizeConfig({ check_interval: '7', language: 'it', send_snippet: false });
  assert.equal(config.checkIntervalMs, 120_000);
  assert.equal(config.language, 'fr');
  assert.equal(config.sendSnippet, false);
  assert.equal(normalizeConfig({ check_interval: 15 }).checkIntervalMs, 900_000);
});

test('the same login on the same server twice is one mailbox', () => {
  const config = normalizeConfig({
    account_1_host: 'imap.example.com',
    account_1_username: 'Alice@example.com',
    account_1_password: 'a',
    account_2_host: 'IMAP.example.com',
    account_2_username: 'alice@example.com',
    account_2_password: 'b',
  });
  assert.deepEqual(
    config.accounts.map((account) => account.slot),
    [1],
  );
});
