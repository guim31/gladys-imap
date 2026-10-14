// -----------------------------------------------------------------------------
// One IMAP account: a single connection (imapflow), IDLE on the first watched
// folder for real time, a full check of every folder at the chosen interval
// (the other folders, the unread counter, servers without IDLE), and a
// reconnection with a growing delay.
//
// Guarantees, each pinned by a test:
// - nothing is ever marked as read by a check: envelopes, structure and the
//   extract are fetched with BODY.PEEK (imapflow), and only the "Mark as read"
//   scene action writes a flag;
// - no body is kept: the extract is cut from the first SNIPPET_BYTES of one
//   text part and handed over at once;
// - bounded memory and no flood: only the UIDs above the last one seen fire,
//   and at most MAX_CATCHUP per folder and check (after a long outage);
// - the first start (or a new UIDVALIDITY) takes a baseline: nothing fires
//   for the mails already in the box.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createLogger } from '@gladysassistant/integration-sdk';
import { ImapFlow } from 'imapflow';
import { createFailureLog } from './log.js';
import { SNIPPET_BYTES, describeMessage, findTextPart, makeSnippet } from './message.js';

const logger = createLogger({ name: 'imap-mailbox' });

export const MAX_CATCHUP = 20;
export const RECENT_SIZE = 8;
// Reconnection delays, then the last one forever. A refused password waits
// longer: some providers lock an account after repeated failures.
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
export const AUTH_RETRY_MS = 30 * 60_000;
// IDLE is renewed well before the 29 minutes after which servers may drop it.
const MAX_IDLE_MS = 10 * 60_000;
const UNREAD_DEBOUNCE_MS = 2_000;

export const ERROR_KINDS = {
  AUTH: 'auth',
  TLS: 'tls',
  NETWORK: 'network',
  FOLDER: 'folder',
  STALE: 'stale',
  OTHER: 'other',
};

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'EPROTO',
]);
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'NoConnection',
  'EConnectionClosed',
]);

/** What went wrong, in one word the texts and the logs know. */
export function classifyError(err) {
  if (!err) {
    return ERROR_KINDS.OTHER;
  }
  if (err.kind && Object.values(ERROR_KINDS).includes(err.kind)) {
    return err.kind;
  }
  if (err.authenticationFailed) {
    return ERROR_KINDS.AUTH;
  }
  const code = String(err.code ?? '');
  if (TLS_CODES.has(code) || /certificate|STARTTLS|ssl|tls/i.test(err.message ?? '')) {
    return ERROR_KINDS.TLS;
  }
  if (NETWORK_CODES.has(code) || /timeout|closed/i.test(err.message ?? '')) {
    return ERROR_KINDS.NETWORK;
  }
  if (
    err.mailboxMissing ||
    err.serverResponseCode === 'NONEXISTENT' ||
    /mailbox|folder/i.test(err.responseText ?? '')
  ) {
    return ERROR_KINDS.FOLDER;
  }
  return ERROR_KINDS.OTHER;
}

export function kindError(kind, message, options) {
  const err = new Error(message, options);
  err.kind = kind;
  return err;
}

/** Stable id of an account: login and server, never the slot it was typed in. */
export function accountId(account) {
  return createHash('sha256')
    .update(`${account.username.toLowerCase()}@${account.host}`)
    .digest('hex')
    .slice(0, 16);
}

/** The name the user knows the mailbox by. */
export function accountName(account) {
  return account.username.includes('@') ? account.username : `${account.username}@${account.host}`;
}

/** imapflow options of an account: TLS always, bounded responses, no library log. */
export function clientOptions(account) {
  return {
    host: account.host,
    port: account.port,
    secure: account.security === 'tls',
    // STARTTLS is required, never optional: without it imapflow would carry
    // on in cleartext when the server (or someone on the path) hides it.
    ...(account.security === 'starttls' ? { doSTARTTLS: true } : {}),
    ...(isIP(account.host) ? {} : { servername: account.host }),
    auth: { user: account.username, pass: account.password },
    tls: { rejectUnauthorized: !account.allowSelfSigned },
    clientInfo: { name: 'Gladys Assistant IMAP integration' },
    // imapflow logs through pino on stdout by default: off, the integration
    // logs what matters itself (and never the password).
    logger: false,
    maxIdleTime: MAX_IDLE_MS,
    // IDLE starts this long after the last command (imapflow waits 15 s by
    // default): a mail arriving meanwhile would wait for it. The integration
    // sends its commands in a row, never with a pause in between.
    autoIdleDelay: 1_000,
    connectionTimeout: 30_000,
    greetingTimeout: 16_000,
    // Only envelopes and 4 KB extracts are fetched: a server sending more is
    // broken or hostile, and must not exhaust the 256 MB of the sandbox.
    maxLineLength: 1024 * 1024,
    maxLiteralSize: 4 * 1024 * 1024,
    maxResponseSize: 8 * 1024 * 1024,
  };
}

async function readStream(stream, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    size += buffer.length;
    if (size >= maxBytes) {
      stream.destroy?.();
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

export class Mailbox {
  /**
   * @param {object} options
   * @param {object} options.account normalized account (src/config.js)
   * @param {{ get: Function, set: Function }} options.state last UID seen per folder
   * @param {boolean} [options.sendSnippet]
   * @param {number} [options.checkIntervalMs]
   * @param {(mailbox: Mailbox, mails: object[]) => void} [options.onMails]
   * @param {(mailbox: Mailbox) => void} [options.onChange] unread counter or status changed
   * @param {(options: object) => object} [options.createClient] test seam
   * @param {object} [options.timers] test seam ({ setTimeout, clearTimeout })
   */
  constructor({
    account,
    state,
    sendSnippet = true,
    checkIntervalMs = 120_000,
    onMails = () => {},
    onChange = () => {},
    createClient = (options) => new ImapFlow(options),
    timers = globalThis,
  }) {
    this.account = account;
    this.id = accountId(account);
    this.name = accountName(account);
    this.label = `mailbox ${account.slot} (${account.host})`;
    this.primary = account.folders[0];
    this.state = state;
    this.sendSnippet = sendSnippet;
    this.checkIntervalMs = checkIntervalMs;
    this.onMails = onMails;
    this.onChange = onChange;
    this.createClient = createClient;
    this.timers = timers;

    this.client = null;
    this.connected = false;
    this.lastErrorKind = null;
    this.unread = null;
    this.recent = [];
    this.missingFolders = new Set();
    this.paths = new Map(); // path opened by imapflow -> configured folder
    this.stopped = true;
    this.attempt = 0;
    this.retryTimer = null;
    this.checkTimer = null;
    this.unreadTimer = null;
    this.chain = Promise.resolve();
    this.failureLog = createFailureLog(logger, { recovered: `${this.label} connected again` });
  }

  start() {
    this.stopped = false;
    return this.connect();
  }

  async stop() {
    this.stopped = true;
    this.clearTimers();
    const client = this.client;
    this.client = null;
    this.connected = false;
    if (client) {
      await Promise.race([
        client.logout().catch(() => client.close?.()),
        new Promise((resolve) => this.timers.setTimeout(resolve, 3_000)),
      ]);
      client.close?.();
    }
    await this.chain.catch(() => {});
  }

  clearTimers() {
    for (const name of ['retryTimer', 'checkTimer', 'unreadTimer']) {
      if (this[name]) {
        this.timers.clearTimeout(this[name]);
        this[name] = null;
      }
    }
  }

  /**
   * Runs operations one after the other on the single connection. Refused
   * until the connection is up (logged in and first check done), except for
   * the first check itself: a STATUS before the login answers nothing, which
   * would read as "0 unread".
   */
  queue(operation, { connecting = false } = {}) {
    const run = this.chain.then(() => {
      if (!this.client || this.stopped || (!this.connected && !connecting)) {
        const err = kindError(ERROR_KINDS.NETWORK, `${this.label} is not connected`);
        err.notReady = true;
        throw err;
      }
      return operation(this.client);
    });
    this.chain = run.catch(() => {});
    return run;
  }

  async connect() {
    if (this.stopped || this.client) {
      return; // stopped, or a connection is already open or opening
    }
    const client = this.createClient(clientOptions(this.account));
    this.client = client;
    // An 'error' event without listener would end the process.
    client.on('error', (err) => logger.debug(`${this.label}: ${err.message}`));
    client.on('close', () => this.onClose(client));
    client.on('exists', (event) => {
      // imapflow reports the path it opened, namespace prefix included
      // ("INBOX.Alerts" for "Alerts" on some servers): back to the folder
      // of the configuration, or ignored.
      const folder = this.paths.get(event.path);
      if (this.connected && folder && event.count > event.prevCount) {
        this.queue(async () => {
          await this.checkFolder(folder);
          await this.refreshUnread();
        }).catch((err) => this.onCheckError(err));
      }
    });
    client.on('flags', () => this.scheduleUnread());
    client.on('expunge', () => this.scheduleUnread());
    try {
      await client.connect();
      // Baseline or catch-up of every folder, the first one last so that IDLE
      // runs on it afterwards.
      await this.queue(() => this.checkAll({ loadRecent: true }), { connecting: true });
      this.connected = true;
      this.attempt = 0;
      this.lastErrorKind = null;
      if (this.failureLog.failing) {
        this.failureLog.ok();
      } else {
        logger.info(`${this.label} connected`);
      }
      this.scheduleCheck();
      this.onChange(this);
    } catch (err) {
      this.fail(err, client);
    }
  }

  fail(err, client) {
    if (this.client !== client) {
      // Stopped (or replaced) while connecting: this connection is orphaned.
      client.close?.();
      return;
    }
    const kind = classifyError(err);
    this.lastErrorKind = kind;
    this.connected = false;
    this.client = null;
    client.close?.();
    this.clearTimers();
    this.failureLog.fail(`${this.label} unavailable (${kind}): ${err.message}`);
    this.onChange(this);
    this.scheduleReconnect(kind);
  }

  onClose(client) {
    if (this.client !== client || this.stopped) {
      return;
    }
    this.fail(kindError(ERROR_KINDS.NETWORK, 'connection closed by the server'), client);
  }

  scheduleReconnect(kind) {
    if (this.stopped) {
      return;
    }
    const delay =
      kind === ERROR_KINDS.AUTH
        ? AUTH_RETRY_MS
        : RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)];
    this.attempt += 1;
    logger.debug(`${this.label}: reconnecting in ${delay / 1000} s`);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  scheduleCheck() {
    if (this.stopped) {
      return;
    }
    if (this.checkTimer) {
      this.timers.clearTimeout(this.checkTimer);
    }
    const client = this.client;
    this.checkTimer = this.timers.setTimeout(() => {
      this.checkTimer = null;
      this.queue(() => this.checkAll())
        .catch((err) => this.onCheckError(err))
        .finally(() => {
          // Only on the same, still healthy connection: a reconnection arms
          // its own timer, and a stale one would pile up checks.
          if (this.client === client && this.connected) {
            this.scheduleCheck();
          }
        });
    }, this.checkIntervalMs);
  }

  scheduleUnread() {
    if (this.unreadTimer || this.stopped) {
      return;
    }
    this.unreadTimer = this.timers.setTimeout(() => {
      this.unreadTimer = null;
      this.queue(() => this.refreshUnread()).catch((err) => this.onCheckError(err));
    }, UNREAD_DEBOUNCE_MS);
  }

  onCheckError(err) {
    const client = this.client;
    if (!client || err?.notReady) {
      return;
    }
    // A broken connection reconnects; anything else is logged and the next
    // check tries again.
    if (classifyError(err) === ERROR_KINDS.NETWORK || client.usable === false) {
      this.fail(err, client);
      return;
    }
    logger.warn(`${this.label}: check failed: ${err.message}`);
  }

  /** Every folder, the unread counter, and the first folder selected again for IDLE. */
  async checkAll({ loadRecent = false } = {}) {
    const ordered = [...this.account.folders.slice(1), this.primary];
    for (const folder of ordered) {
      await this.checkFolder(folder, { loadRecent: loadRecent && folder === this.primary });
    }
    await this.refreshUnread();
  }

  /** Locks a folder, runs `fn`, then selects the first folder again (IDLE). */
  async inFolder(folder, fn) {
    const client = this.client;
    try {
      let lock;
      try {
        lock = await client.getMailboxLock(folder);
      } catch (err) {
        if (classifyError(err) === ERROR_KINDS.FOLDER || err.mailboxMissing) {
          throw kindError(ERROR_KINDS.FOLDER, `folder "${folder}" not found`, { cause: err });
        }
        throw err;
      }
      try {
        this.paths.set(client.mailbox.path, folder);
        return await fn(client, client.mailbox);
      } finally {
        lock.release();
      }
    } finally {
      // Also after a failed SELECT, which leaves no folder selected.
      if (folder !== this.primary && !this.missingFolders.has(this.primary) && client.usable) {
        const back = await client.getMailboxLock(this.primary).catch(() => null);
        back?.release();
      }
    }
  }

  async checkFolder(folder, { loadRecent = false } = {}) {
    let mails;
    try {
      mails = await this.inFolder(folder, (client, mailbox) =>
        this.readNew(client, mailbox, folder, loadRecent),
      );
    } catch (err) {
      if (err.kind === ERROR_KINDS.FOLDER) {
        if (!this.missingFolders.has(folder)) {
          this.missingFolders.add(folder);
          logger.warn(`${this.label}: folder "${folder}" not found, skipped`);
        }
        return;
      }
      throw err;
    }
    if (this.missingFolders.delete(folder)) {
      logger.info(`${this.label}: folder "${folder}" found`);
    }
    if (mails.length > 0) {
      this.remember(mails);
      this.onMails(this, mails);
    }
  }

  async readNew(client, mailbox, folder, loadRecent) {
    const uidValidity = String(mailbox.uidValidity);
    if (loadRecent && this.recent.length === 0) {
      await this.loadRecent(client, mailbox, folder);
    }
    const known = this.state.get(this.id, folder);
    if (!known || known.uidValidity !== uidValidity) {
      // First start, or a mailbox rebuilt by the server: only what arrives
      // from now on counts.
      const lastUid = await this.highestUid(client, mailbox);
      this.state.set(this.id, folder, { uidValidity, lastUid });
      logger.debug(`${this.label}: baseline of "${folder}" at UID ${lastUid}`);
      return [];
    }
    // The UIDs first (numbers only, whatever arrived meanwhile), then the
    // envelopes of the newest MAX_CATCHUP: memory stays bounded after an
    // import of thousands of mails. "n:*" also returns the last message when
    // no UID reaches n.
    const found = await client.search({ uid: `${known.lastUid + 1}:*` }, { uid: true });
    const uids = (Array.isArray(found) ? found : [])
      .filter((uid) => uid > known.lastUid)
      .sort((a, b) => a - b);
    if (uids.length === 0) {
      return [];
    }
    const lastUid = uids[uids.length - 1];
    const keptUids = uids.slice(-MAX_CATCHUP);
    if (uids.length > keptUids.length) {
      logger.info(
        `${this.label}: ${uids.length - keptUids.length} older new mails in "${folder}" skipped`,
      );
    }
    const kept = [];
    for await (const message of client.fetch(
      keptUids.join(','),
      { uid: true, envelope: true, internalDate: true, bodyStructure: this.sendSnippet },
      { uid: true },
    )) {
      kept.push(message);
    }
    kept.sort((a, b) => a.uid - b.uid);
    const mails = [];
    // The extracts are downloaded after the FETCH loop: imapflow cannot run
    // a command while it streams another one.
    for (const message of kept) {
      const mail = { ...describeMessage(message), folder, uidValidity, snippet: '' };
      if (this.sendSnippet) {
        mail.snippet = await this.readSnippet(client, message);
      }
      mails.push(mail);
      logger.debug(`${this.label}: new mail in "${folder}" from ${mail.fromAddress}`);
    }
    this.state.set(this.id, folder, { uidValidity, lastUid });
    return mails;
  }

  async highestUid(client, mailbox) {
    if (!mailbox.exists) {
      return Math.max(0, (mailbox.uidNext ?? 1) - 1);
    }
    let highest = 0;
    for await (const message of client.fetch('*', { uid: true })) {
      highest = Math.max(highest, message.uid);
    }
    return Math.max(highest, (mailbox.uidNext ?? 1) - 1);
  }

  async loadRecent(client, mailbox, folder) {
    if (!mailbox.exists) {
      return;
    }
    const first = Math.max(1, mailbox.exists - RECENT_SIZE + 1);
    const recent = [];
    for await (const message of client.fetch(`${first}:*`, {
      uid: true,
      envelope: true,
      internalDate: true,
    })) {
      recent.push({ ...describeMessage(message), folder });
    }
    this.remember(recent);
  }

  async readSnippet(client, message) {
    const text = findTextPart(message.bodyStructure);
    if (!text) {
      return '';
    }
    try {
      const { content } = await client.download(String(message.uid), text.part, {
        uid: true,
        maxBytes: SNIPPET_BYTES,
      });
      if (!content) {
        return '';
      }
      return makeSnippet(await readStream(content, SNIPPET_BYTES), text.html);
    } catch (err) {
      logger.debug(`${this.label}: no extract for UID ${message.uid}: ${err.message}`);
      return '';
    }
  }

  /** Newest first, headers only, RECENT_SIZE at most. */
  remember(mails) {
    const merged = [
      ...mails.map(({ fromAddress, fromName, subject, date, folder }) => ({
        fromAddress,
        fromName,
        subject,
        date,
        folder,
      })),
      ...this.recent,
    ];
    merged.sort((a, b) => b.date - a.date);
    this.recent = merged.slice(0, RECENT_SIZE);
  }

  async countUnread(client) {
    let total = 0;
    for (const folder of this.account.folders) {
      if (this.missingFolders.has(folder)) {
        continue;
      }
      const status = await client.status(folder, { unseen: true });
      if (!status || typeof status.unseen !== 'number') {
        throw kindError(ERROR_KINDS.NETWORK, `no unread count for "${folder}"`);
      }
      total += status.unseen;
    }
    return total;
  }

  async refreshUnread(client = this.client) {
    const unread = await this.countUnread(client);
    if (unread !== this.unread) {
      this.unread = unread;
      this.onChange(this);
    }
    return unread;
  }

  /** Live counter, for the scene action. */
  readUnread() {
    return this.queue((client) => this.refreshUnread(client));
  }

  /** Flags ONE message as read, if its folder still has the same UIDVALIDITY. */
  markAsRead(ref) {
    return this.queue(async () => {
      if (!this.account.folders.includes(ref.folder)) {
        throw kindError(ERROR_KINDS.FOLDER, `folder "${ref.folder}" is not watched`);
      }
      const done = await this.inFolder(ref.folder, async (client, mailbox) => {
        if (String(mailbox.uidValidity) !== ref.uidValidity) {
          throw kindError(ERROR_KINDS.STALE, 'the folder was rebuilt by the server');
        }
        return client.messageFlagsAdd(String(ref.uid), ['\\Seen'], { uid: true });
      });
      await this.refreshUnread();
      return done !== false;
    });
  }
}

/**
 * Connection test for the Configuration screen: log in, open every folder,
 * log out. Never keeps the connection.
 * @returns {Promise<{ ok: boolean, kind?: string, unread?: number, missing?: string[] }>}
 */
export async function testAccount(account, createClient = (options) => new ImapFlow(options)) {
  const client = createClient(clientOptions(account));
  client.on('error', () => {});
  try {
    await client.connect();
    const missing = [];
    let unread = 0;
    for (const folder of account.folders) {
      try {
        const status = await client.status(folder, { unseen: true });
        unread += Number(status?.unseen ?? 0);
      } catch {
        missing.push(folder);
      }
    }
    await client.logout().catch(() => {});
    return { ok: true, unread, missing };
  } catch (err) {
    client.close?.();
    return { ok: false, kind: classifyError(err) };
  }
}
