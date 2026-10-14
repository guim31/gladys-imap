import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  describeMessage,
  findTextPart,
  htmlToText,
  localTime,
  makeSnippet,
  matchKeywords,
  messageRef,
  parseMessageRef,
} from '../src/message.js';
import { parseKeywords } from '../src/config.js';

test('the extract skips the quoted reply and fits 200 characters', () => {
  const text = 'Bonjour,\r\n\r\nLe colis est arrivé.\r\n> Le 12/10, Bob a écrit :\r\n> ancien';
  assert.equal(makeSnippet(text), 'Bonjour, Le colis est arrivé.');
  const long = makeSnippet('word '.repeat(100));
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('…'));
  assert.equal(makeSnippet(''), '');
  assert.equal(makeSnippet(undefined), '');
});

test('the extract of an HTML part is its visible text', () => {
  const html =
    '<html><head><style>p{color:red}</style><title>T</title></head><body><p>Votre&nbsp;commande &amp; <b>facture</b></p><script>x()</script><p>&#233;t&#xE9;</p><!-- hidden -->';
  assert.equal(makeSnippet(html, true), 'Votre commande & facture été');
  assert.equal(htmlToText('<p>a</p><p').trim(), 'a');
});

test('header texts lose control characters and are bounded', () => {
  assert.equal(cleanText('a\u0000b\r\n\tc​d'), 'a b c d');
  assert.equal(cleanText('x'.repeat(1200)).length, 1000);
  assert.equal(cleanText(42), '');
});

test('the text part: the first text/plain, else the HTML, never an attachment', () => {
  assert.deepEqual(findTextPart({ type: 'text/plain' }), { part: '1', html: false });
  assert.deepEqual(
    findTextPart({
      type: 'multipart/mixed',
      childNodes: [
        {
          type: 'multipart/alternative',
          childNodes: [
            { type: 'text/html', part: '1.2' },
            { type: 'text/plain', part: '1.1' },
          ],
        },
        { type: 'text/plain', part: '2', disposition: 'attachment' },
      ],
    }),
    { part: '1.1', html: false },
  );
  assert.deepEqual(
    findTextPart({
      type: 'multipart/mixed',
      childNodes: [
        { type: 'text/html', part: '1' },
        { type: 'application/pdf', part: '2' },
      ],
    }),
    { part: '1', html: true },
  );
  assert.equal(findTextPart({ type: 'image/png' }), null);
  assert.equal(findTextPart(undefined), null);
});

test('a message: sender folded to lower case, the name falls back on the address', () => {
  const date = new Date('2026-10-14T08:05:00Z');
  assert.deepEqual(
    describeMessage({
      uid: 7,
      envelope: { from: [{ name: 'Léa', address: 'Lea@Example.COM' }], subject: ' Hi\nthere ' },
      internalDate: date,
    }),
    {
      uid: 7,
      fromAddress: 'lea@example.com',
      fromDomain: 'example.com',
      fromName: 'Léa',
      subject: 'Hi there',
      date,
    },
  );
  const bare = describeMessage({ uid: 8, envelope: { from: [{ address: 'x@y.z' }] } });
  assert.equal(bare.fromName, 'x@y.z');
  assert.equal(bare.subject, '');
  assert.ok(bare.date instanceof Date);
  assert.equal(describeMessage({ uid: 9, envelope: {} }).fromDomain, '');
});

test('keywords are found without case or accents', () => {
  const keywords = parseKeywords('facture, livré, alarme');
  assert.deepEqual(
    matchKeywords('Votre FACTURE : colis LIVRE', keywords).map((keyword) => keyword.label),
    ['facture', 'livré'],
  );
  assert.deepEqual(matchKeywords('Bonjour', keywords), []);
});

test('the mail reference survives a folder name with colons', () => {
  const ref = messageRef('Work:Alerts', '1791979011', 42);
  assert.equal(ref, '1791979011:42:Work:Alerts');
  assert.deepEqual(parseMessageRef(` ${ref} `), {
    uidValidity: '1791979011',
    uid: 42,
    folder: 'Work:Alerts',
  });
  for (const bad of ['', 'abc', '1:0:INBOX', '1:2:', null, 12]) {
    assert.equal(parseMessageRef(bad), null, String(bad));
  }
});

test('the reception time is local, minutes only', () => {
  assert.match(localTime(new Date('2026-10-14T08:05:59Z')), /^2026-10-14 \d\d:05$/);
});
