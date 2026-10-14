// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys: feature name, connection status, the
// "Test the connection" report, the errors of the scene actions, the widget.
// Four languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './mailbox.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

export const FEATURE_UNREAD = {
  en: 'Unread mails',
  fr: 'Mails non lus',
  de: 'Ungelesene E-Mails',
  es: 'Correos no leídos',
};

// One short explanation per error kind (src/mailbox.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.AUTH]: {
    en: 'login refused: check the user and the (app) password',
    fr: "connexion refusée : vérifiez l'utilisateur et le mot de passe (d'application)",
    de: 'Anmeldung abgelehnt: Prüfe Benutzer und (App-)Passwort',
    es: 'inicio de sesión rechazado: compruebe el usuario y la contraseña (de aplicación)',
  },
  [ERROR_KINDS.TLS]: {
    en: 'secure connection failed: check the security mode, the port or the certificate',
    fr: 'connexion sécurisée impossible : vérifiez le mode de sécurité, le port ou le certificat',
    de: 'sichere Verbindung fehlgeschlagen: Prüfe Sicherheitsmodus, Port oder Zertifikat',
    es: 'conexión segura imposible: compruebe el modo de seguridad, el puerto o el certificado',
  },
  [ERROR_KINDS.NETWORK]: {
    en: 'the mail server does not answer',
    fr: 'le serveur de messagerie ne répond pas',
    de: 'der Mailserver antwortet nicht',
    es: 'el servidor de correo no responde',
  },
  [ERROR_KINDS.FOLDER]: {
    en: 'folder not found or not watched',
    fr: 'dossier introuvable ou non surveillé',
    de: 'Ordner nicht gefunden oder nicht überwacht',
    es: 'carpeta no encontrada o no vigilada',
  },
  [ERROR_KINDS.STALE]: {
    en: 'this mail no longer exists in this form on the server',
    fr: "ce mail n'existe plus sous cette forme sur le serveur",
    de: 'diese E-Mail existiert so nicht mehr auf dem Server',
    es: 'este correo ya no existe de esta forma en el servidor',
  },
  [ERROR_KINDS.OTHER]: {
    en: 'unexpected error, see the integration logs',
    fr: "erreur inattendue, consultez les logs de l'intégration",
    de: 'unerwarteter Fehler, sieh in die Logs der Integration',
    es: 'error inesperado, consulte los registros de la integración',
  },
  no_account: {
    en: 'no mailbox configured: fill in server, user and password',
    fr: 'aucune boîte configurée : renseignez serveur, utilisateur et mot de passe',
    de: 'kein Postfach eingerichtet: Gib Server, Benutzer und Passwort ein',
    es: 'ningún buzón configurado: indique servidor, usuario y contraseña',
  },
  unknown_mailbox: {
    en: 'this mailbox is no longer in the configuration',
    fr: "cette boîte n'est plus dans la configuration",
    de: 'dieses Postfach ist nicht mehr in der Konfiguration',
    es: 'este buzón ya no está en la configuración',
  },
  invalid_ref: {
    en: 'invalid mail reference: insert the "Mail reference" variable of the trigger',
    fr: 'référence de mail invalide : insérez la variable « Référence du mail » du déclencheur',
    de: 'ungültige E-Mail-Referenz: Füge die Variable „E-Mail-Referenz“ des Auslösers ein',
    es: 'referencia de correo no válida: inserte la variable «Referencia del correo» del desencadenante',
  },
};

/** Error message in the configured language, for a thrown error or a kind. */
export function errorText(kindOrError, language) {
  const kind =
    typeof kindOrError === 'string' ? kindOrError : (kindOrError?.kind ?? ERROR_KINDS.OTHER);
  return pick(ERROR_TEXT[kind] ?? ERROR_TEXT[ERROR_KINDS.OTHER], language);
}

// Status shown on the Configuration screen when a mailbox is unavailable.
export const STATUS_DOWN = {
  en: (names) => `Unavailable: ${names}. See the integration logs.`,
  fr: (names) => `Indisponible : ${names}. Consultez les logs de l'intégration.`,
  de: (names) => `Nicht erreichbar: ${names}. Sieh in die Logs der Integration.`,
  es: (names) => `No disponible: ${names}. Consulte los registros de la integración.`,
};

export const STATUS_NO_ACCOUNT = {
  en: 'No mailbox configured yet.',
  fr: 'Aucune boîte mail configurée pour le moment.',
  de: 'Noch kein Postfach eingerichtet.',
  es: 'Todavía no hay ningún buzón configurado.',
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Die Initialisierung ist fehlgeschlagen, sieh in die Logs der Integration.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// "Test the connection" report, one line per mailbox (toast ≤ 200 characters
// for three mailboxes: the lines stay short).
export const REPORT_TEXT = {
  en: {
    ok: (slot, unread) => `Mailbox ${slot}: OK, ${unread} unread.`,
    missing: (folders) => `Folders not found: ${folders}.`,
    failed: (slot, reason) => `Mailbox ${slot}: ${reason}.`,
  },
  fr: {
    ok: (slot, unread) => `Boîte ${slot} : OK, ${unread} non lus.`,
    missing: (folders) => `Dossiers introuvables : ${folders}.`,
    failed: (slot, reason) => `Boîte ${slot} : ${reason}.`,
  },
  de: {
    ok: (slot, unread) => `Postfach ${slot}: OK, ${unread} ungelesen.`,
    missing: (folders) => `Ordner nicht gefunden: ${folders}.`,
    failed: (slot, reason) => `Postfach ${slot}: ${reason}.`,
  },
  es: {
    ok: (slot, unread) => `Buzón ${slot}: OK, ${unread} no leídos.`,
    missing: (folders) => `Carpetas no encontradas: ${folders}.`,
    failed: (slot, reason) => `Buzón ${slot}: ${reason}.`,
  },
};

// Dashboard widget.
export const WIDGET_TEXT = {
  unread: { en: 'Unread', fr: 'Non lus', de: 'Ungelesen', es: 'No leídos' },
  empty: {
    en: 'No mail received since the integration started.',
    fr: "Aucun mail reçu depuis le démarrage de l'intégration.",
    de: 'Seit dem Start der Integration keine E-Mail empfangen.',
    es: 'Ningún correo recibido desde el inicio de la integración.',
  },
  no_subject: { en: '(no subject)', fr: '(sans objet)', de: '(kein Betreff)', es: '(sin asunto)' },
  offline: {
    en: 'Mail server unavailable',
    fr: 'Serveur de messagerie indisponible',
    de: 'Mailserver nicht erreichbar',
    es: 'Servidor de correo no disponible',
  },
};
