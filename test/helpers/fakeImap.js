// -----------------------------------------------------------------------------
// An in-memory IMAP server with the slice of the imapflow client API the
// integration uses (connect, getMailboxLock, fetch, download, status,
// messageFlagsAdd, logout, events). It records every flag change, so a test
// can prove that a check never marks a mail as read. The real behaviour was
// checked against GreenMail in Docker (see CLAUDE.md).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

export const USER = 'alice@example.com';
export const PASSWORD = 'correct horse battery staple';
export const HOST = 'imap.example.com';

const plain = (text) => ({ type: 'text/plain', part: undefined, text });

/** A message as the tests write it, completed with what a server stores. */
export function mail({
  from = 'Alerts <alerts@example.net>',
  subject = 'Hello',
  text = 'Body of the mail.',
  html,
  date = new Date('2026-10-14T08:05:00Z'),
  seen = false,
} = {}) {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(from);
  const address = match ? { name: match[1], address: match[2] } : { address: from };
  const parts = html
    ? {
        type: 'multipart/alternative',
        childNodes: [
          { type: 'text/plain', part: '1', text },
          { type: 'text/html', part: '2', text: html },
        ],
      }
    : plain(text);
  return {
    envelope: { from: [address], subject, date },
    internalDate: date,
    structure: parts,
    flags: new Set(seen ? ['\\Seen'] : []),
  };
}

function strip(node) {
  if (node.childNodes) {
    return { type: node.type, childNodes: node.childNodes.map(strip) };
  }
  return { type: node.type, ...(node.part ? { part: node.part } : {}) };
}

function findPart(node, part) {
  if (node.childNodes) {
    for (const child of node.childNodes) {
      const found = findPart(child, part);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return (node.part ?? '1') === part ? node : null;
}

export class FakeImapServer {
  /**
   * @param {object} [options]
   * @param {string} [options.prefix] namespace prefix the server adds to the
   *   folders other than INBOX ("INBOX." on Courier), as imapflow reports it
   */
  constructor({ folders = ['INBOX'], users = { [USER]: PASSWORD }, prefix = '' } = {}) {
    this.users = users;
    this.prefix = prefix;
    this.folders = new Map();
    for (const name of folders) {
      this.addFolder(name);
    }
    this.clients = [];
    this.down = false;
    this.flagChanges = []; // { folder, uid, flags }
    this.downloads = []; // { uid, part, maxBytes }
    this.connections = 0;
    this.createClient = (options) => {
      const client = new FakeImapClient(this, options);
      this.clients.push(client);
      return client;
    };
  }

  addFolder(name, uidValidity = 1000n + BigInt(this.folders.size)) {
    this.folders.set(name, { uidValidity, uidNext: 1, messages: [] });
  }

  /** The path imapflow reports for a folder once opened. */
  opened(name) {
    return name === 'INBOX' ? name : `${this.prefix}${name}`;
  }

  /** Stores mails in a folder; `notify` emits EXISTS to the clients that selected it. */
  deliver(folderName, mails, { notify = true } = {}) {
    const folder = this.folders.get(folderName);
    const list = Array.isArray(mails) ? mails : [mails];
    for (const message of list) {
      folder.messages.push({ ...message, uid: folder.uidNext });
      folder.uidNext += 1;
    }
    if (notify) {
      for (const client of this.clients) {
        if (client.usable && client.selected === folderName) {
          client.mailbox.exists = folder.messages.length;
          client.mailbox.uidNext = folder.uidNext;
          client.emit('exists', {
            path: this.opened(folderName),
            count: folder.messages.length,
            prevCount: folder.messages.length - list.length,
          });
        }
      }
    }
  }

  /** The server rebuilds a folder (new UIDVALIDITY, UIDs from 1 again). */
  rebuild(folderName) {
    const folder = this.folders.get(folderName);
    folder.uidValidity += 100n;
    folder.messages = folder.messages.map((message, index) => ({ ...message, uid: index + 1 }));
    folder.uidNext = folder.messages.length + 1;
  }

  /** Every open connection drops, as on a server restart. */
  dropConnections() {
    for (const client of this.clients) {
      client.drop();
    }
  }

  get openClients() {
    return this.clients.filter((client) => client.usable);
  }
}

export class FakeImapClient extends EventEmitter {
  constructor(server, options) {
    super();
    this.server = server;
    this.options = options;
    this.usable = false;
    this.mailbox = false;
  }

  async connect() {
    this.server.connections += 1;
    if (this.server.down) {
      const err = new Error('connect ECONNREFUSED 192.0.2.10:993');
      err.code = 'ECONNREFUSED';
      throw err;
    }
    const { user, pass } = this.options.auth;
    if (this.server.users[user] !== pass) {
      const err = new Error('Command failed');
      err.authenticationFailed = true;
      err.responseText = 'Invalid credentials';
      throw err;
    }
    this.usable = true;
  }

  drop() {
    if (this.usable) {
      this.usable = false;
      this.mailbox = false;
      this.selected = null;
      this.emit('close');
    }
  }

  async logout() {
    this.drop();
  }

  close() {
    this.drop();
  }

  checkUsable() {
    if (!this.usable) {
      const err = new Error('Connection not available');
      err.code = 'NoConnection';
      throw err;
    }
  }

  folder(path) {
    const folder = this.server.folders.get(path);
    if (!folder) {
      const err = new Error('Command failed');
      err.serverResponseCode = 'NONEXISTENT';
      err.responseText = 'Mailbox does not exist';
      throw err;
    }
    return folder;
  }

  async getMailboxLock(path) {
    this.checkUsable();
    const folder = this.folder(path);
    this.selected = path;
    this.mailbox = {
      path: this.server.opened(path),
      uidValidity: folder.uidValidity,
      uidNext: folder.uidNext,
      exists: folder.messages.length,
    };
    return { path, release: () => {} };
  }

  messagesOf(range, byUid) {
    const folder = this.folder(this.selected);
    const messages = folder.messages;
    if (messages.length === 0) {
      return [];
    }
    const [startText, endText = startText] = String(range).split(':');
    const last = byUid ? messages[messages.length - 1].uid : messages.length;
    const start = startText === '*' ? last : Number(startText);
    const end = endText === '*' ? last : Number(endText);
    const [low, high] = start <= end ? [start, end] : [end, start];
    return messages.filter((message, index) => {
      const key = byUid ? message.uid : index + 1;
      return key >= low && key <= high;
    });
  }

  async search(query, options = {}) {
    this.checkUsable();
    this.server.searches = (this.server.searches ?? 0) + 1;
    return this.messagesOf(query.uid, options.uid === true).map((message) => message.uid);
  }

  messagesByList(range, byUid) {
    if (!String(range).includes(',')) {
      return this.messagesOf(range, byUid);
    }
    const wanted = new Set(String(range).split(',').map(Number));
    return this.folder(this.selected).messages.filter((message) => wanted.has(message.uid));
  }

  async *fetch(range, query, options = {}) {
    this.checkUsable();
    this.server.fetched = (this.server.fetched ?? 0) + 1;
    for (const message of this.messagesByList(range, options.uid === true)) {
      yield {
        uid: message.uid,
        ...(query.envelope ? { envelope: structuredClone(message.envelope) } : {}),
        ...(query.internalDate ? { internalDate: message.internalDate } : {}),
        ...(query.bodyStructure ? { bodyStructure: strip(message.structure) } : {}),
      };
    }
  }

  async download(range, part, options = {}) {
    this.checkUsable();
    const [message] = this.messagesOf(range, options.uid === true);
    this.server.downloads.push({ uid: Number(range), part, maxBytes: options.maxBytes });
    const node = message && findPart(message.structure, part);
    if (!node) {
      return {};
    }
    const bytes = Buffer.from(node.text, 'utf8').subarray(0, options.maxBytes ?? Infinity);
    return { meta: { contentType: node.type }, content: Readable.from([bytes]) };
  }

  async status(path, query) {
    this.checkUsable();
    const folder = this.folder(path);
    return {
      path,
      ...(query.unseen
        ? { unseen: folder.messages.filter((m) => !m.flags.has('\\Seen')).length }
        : {}),
    };
  }

  async messageFlagsAdd(range, flags, options = {}) {
    this.checkUsable();
    const messages = this.messagesOf(range, options.uid === true);
    for (const message of messages) {
      flags.forEach((flag) => message.flags.add(flag));
      this.server.flagChanges.push({ folder: this.selected, uid: message.uid, flags });
    }
    return messages.length > 0;
  }
}
