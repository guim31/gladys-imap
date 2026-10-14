// -----------------------------------------------------------------------------
// Integration configuration (the `config_schema` of the manifest), normalized
// so the rest of the code never deals with `undefined`, numbers typed as
// strings or folder lists typed with spaces.
//
// Up to three mailboxes, one block of fields each (`account_<n>_…`): a manifest
// action cannot carry a password (a `secret` action field cannot be filled in,
// GladysAssistant/Gladys#3154), so the accounts cannot be added by actions.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const ACCOUNT_SLOTS = [1, 2, 3];
export const SECURITY_MODES = ['tls', 'starttls'];
// Minutes between two full checks (folders other than the first one, unread
// counters, servers without IDLE). The first folder is watched in real time.
export const CHECK_INTERVALS = ['1', '2', '5', '15'];

const DEFAULT_ACCOUNT = {
  host: '',
  port: 993,
  security: 'tls',
  username: '',
  password: '',
  folders: 'INBOX',
  allow_self_signed: false,
};

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js).
export const DEFAULT_CONFIG = {
  ...Object.fromEntries(
    ACCOUNT_SLOTS.flatMap((slot) =>
      Object.entries(DEFAULT_ACCOUNT).map(([key, value]) => [`account_${slot}_${key}`, value]),
    ),
  ),
  subject_keywords: '',
  send_snippet: true,
  check_interval: '2',
  language: 'fr',
};

// Folder names are limited so that one mistyped list cannot open dozens of
// mailboxes on the server.
export const MAX_FOLDERS = 5;
export const MAX_KEYWORDS = 20;

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/** "INBOX, Alerts" -> ['INBOX', 'Alerts'], without duplicates, INBOX by default. */
export function parseFolders(value) {
  const folders = [];
  for (const raw of trimmed(value).split(',')) {
    const name = raw.trim();
    const folder = name.toUpperCase() === 'INBOX' ? 'INBOX' : name;
    if (folder && !folders.includes(folder)) {
      folders.push(folder);
    }
  }
  return folders.length > 0 ? folders.slice(0, MAX_FOLDERS) : ['INBOX'];
}

/**
 * Lower case, without accents or surrounding spaces: how the keywords and the
 * subjects are compared, and how the trigger filters are emitted.
 */
export function fold(text) {
  return trimmed(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * "Facture, colis ,Colis" -> [{ label: 'Facture', folded: 'facture' }, { label: 'colis', … }]:
 * the label (as typed) is what the trigger emits, the folded form what the
 * subject is compared with.
 */
export function parseKeywords(value) {
  const keywords = [];
  for (const raw of trimmed(value).split(',')) {
    const label = raw.trim().replace(/\s+/g, ' ');
    const folded = fold(label);
    if (folded && !keywords.some((keyword) => keyword.folded === folded)) {
      keywords.push({ label, folded });
    }
  }
  return keywords.slice(0, MAX_KEYWORDS);
}

function parsePort(value, security) {
  const port = Number(typeof value === 'string' ? value.trim() : value);
  if (Number.isInteger(port) && port > 0 && port < 65536) {
    return port;
  }
  return security === 'starttls' ? 143 : 993;
}

/** A host typed as an address ("imaps://mail.example.com:993/") keeps its name only. */
function parseHost(value) {
  return trimmed(value)
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/:].*$/, '')
    .toLowerCase();
}

/**
 * The accounts that are filled in (host, user and password), in slot order.
 * @returns {Array<{ slot: number, host: string, port: number, security: string,
 *   username: string, password: string, folders: string[], allowSelfSigned: boolean }>}
 */
function parseAccounts(config) {
  const accounts = [];
  for (const slot of ACCOUNT_SLOTS) {
    const value = (key) => config[`account_${slot}_${key}`];
    const host = parseHost(value('host'));
    const username = trimmed(value('username'));
    // A password may legitimately start or end with a space: kept as typed.
    const password = typeof value('password') === 'string' ? value('password') : '';
    if (!host || !username || !password) {
      continue;
    }
    // The same login on the same server twice would be one device twice.
    if (
      accounts.some(
        (other) => other.host === host && other.username.toLowerCase() === username.toLowerCase(),
      )
    ) {
      continue;
    }
    const security = SECURITY_MODES.includes(value('security')) ? value('security') : 'tls';
    accounts.push({
      slot,
      host,
      port: parsePort(value('port'), security),
      security,
      username,
      password,
      folders: parseFolders(value('folders')),
      allowSelfSigned: value('allow_self_signed') === true,
    });
  }
  return accounts;
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  const interval = String(config.check_interval);
  return {
    accounts: parseAccounts(config),
    keywords: parseKeywords(config.subject_keywords),
    sendSnippet: config.send_snippet !== false,
    checkIntervalMs:
      Number(CHECK_INTERVALS.includes(interval) ? interval : DEFAULT_CONFIG.check_interval) *
      60_000,
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}
