// -----------------------------------------------------------------------------
// What a received mail becomes for Gladys: a few header values and, when the
// user allows it, a short plain-text extract. Nothing here keeps the body: the
// extract is cut from at most SNIPPET_BYTES of the first text part, then
// dropped once the scene event is sent.
// -----------------------------------------------------------------------------

import { fold } from './config.js';

export const SNIPPET_LENGTH = 200;
// Bytes of the text part downloaded for the extract (BODY.PEEK partial fetch).
export const SNIPPET_BYTES = 4096;
// The core takes string values of 1000 characters at most in a scene event.
const MAX_VALUE = 1000;

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** One line, no control character, bounded. */
export function cleanText(value, max = MAX_VALUE) {
  if (typeof value !== 'string') {
    return '';
  }
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]+/g, ' ');
  return cut(text.replace(/\s+/g, ' ').trim(), max);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Visible text of an HTML fragment, good enough for a 200-character extract. */
export function htmlToText(html) {
  return html
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, ' ')
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]*(>|$)/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
      if (code[0] === '#') {
        const point =
          code[1] === 'x' || code[1] === 'X'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point < 0x110000
          ? String.fromCodePoint(point)
          : ' ';
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    });
}

/**
 * The extract shown to the scenes: the first lines of the text, without the
 * quoted reply ("> …") nor the "On …, X wrote:" line that introduces it.
 * @param {string} text decoded text part (possibly cut in the middle)
 * @param {boolean} isHtml
 */
export function makeSnippet(text, isHtml = false) {
  if (typeof text !== 'string' || text === '') {
    return '';
  }
  const plain = isHtml ? htmlToText(text) : text;
  const lines = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('>'));
  return cleanText(lines.join(' '), SNIPPET_LENGTH);
}

/**
 * The text part to read for the extract: the first text/plain that is not an
 * attachment, else the first text/html. `part` is the IMAP section ("1.2"),
 * "1" for a single-part message (imapflow maps it to TEXT).
 * @param {object} node imapflow bodyStructure
 * @returns {{ part: string, html: boolean } | null}
 */
export function findTextPart(node) {
  if (!node) {
    return null;
  }
  const candidates = [];
  const walk = (current) => {
    if (Array.isArray(current.childNodes) && current.childNodes.length > 0) {
      current.childNodes.forEach(walk);
      return;
    }
    if (current.disposition === 'attachment') {
      return;
    }
    if (current.type === 'text/plain' || current.type === 'text/html') {
      candidates.push({ part: current.part ?? '1', html: current.type === 'text/html' });
    }
  };
  walk(node);
  return candidates.find((candidate) => !candidate.html) ?? candidates[0] ?? null;
}

/**
 * The header values of a message, from an imapflow FETCH result (envelope,
 * internalDate). Addresses are folded to lower case: the scene filters only
 * compare for equality.
 */
export function describeMessage(fetched) {
  const from = fetched.envelope?.from?.[0] ?? {};
  const address = cleanText(from.address ?? '', 320).toLowerCase();
  const at = address.lastIndexOf('@');
  const date = fetched.internalDate ?? fetched.envelope?.date;
  const time = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return {
    uid: fetched.uid,
    fromAddress: address,
    fromDomain: at >= 0 ? address.slice(at + 1) : '',
    fromName: cleanText(from.name ?? '', 200) || address,
    subject: cleanText(fetched.envelope?.subject ?? '', 500),
    date: time,
  };
}

/** The configured keywords found in a subject (accents and case ignored). */
export function matchKeywords(subject, keywords) {
  const folded = fold(subject);
  return keywords.filter((keyword) => folded.includes(keyword.folded));
}

/**
 * "2026-10-14 08:05", in the time zone of the container (Gladys injects TZ).
 * @param {Date} date
 */
export function localTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * The reference a scene passes back to "Mark as read": folder, UIDVALIDITY and
 * UID, so that a mailbox rebuilt by the server (new UIDVALIDITY) can never
 * flag another message.
 */
export function messageRef(folder, uidValidity, uid) {
  return `${uidValidity}:${uid}:${folder}`;
}

/** @returns {{ folder: string, uidValidity: string, uid: number } | null} */
export function parseMessageRef(value) {
  const match = /^(\d+):(\d+):(.+)$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) {
    return null;
  }
  const uid = Number(match[2]);
  return uid > 0 ? { uidValidity: match[1], uid, folder: match[3] } : null;
}
