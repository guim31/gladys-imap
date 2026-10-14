# IMAP Mail for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that
turns the mails you **receive** into scene triggers. It watches up to three
IMAP mailboxes (Gmail, Outlook, iCloud, your own server…), fires a trigger for
each new mail, counts the unread mails of each mailbox, and shows the latest
mails on the dashboard.

To **send** mails from Gladys, use the official
[gladys-smtp](https://github.com/GladysAssistant/gladys-smtp) integration: this
one only reads.

## Features

- **Scene triggers**
  - _Mail received_, filtered by mailbox, sender address, sender domain and
    folder;
  - _Keyword in a mail subject_, for the keywords listed in the configuration
    (case and accents ignored).

  Both pass to the scene the mailbox, folder, sender name and address, subject,
  a 200-character extract (can be switched off), the reception time and a mail
  reference.

- **Devices**: one per mailbox, with its unread counter (unread mails of the
  watched folders).
- **Scene actions**: _Read the unread count_ (live, for a condition or a
  message) and _Mark as read_ (the mail of the trigger, and only that one).
- **Widget** _Latest mails_: the unread counter and the last 8 mails (sender,
  subject, time; never the body), for one mailbox or all.
- **Test the connection** on the Configuration screen.
- Texts and documentation in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- An IMAP account with TLS (993) or STARTTLS (143). Gmail, Outlook, iCloud and
  Yahoo need an **app password**; OAuth2 sign-in is not supported.

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-imap`. Fill in a mailbox block (server, user,
password, folders), click **Test the connection**, then add the mailbox device
from the Discovery tab. The full documentation is in [docs/en.md](docs/en.md)
(also in [French](docs/fr.md), [German](docs/de.md) and
[Spanish](docs/es.md)).

## How it works

- One [imapflow](https://github.com/postalsys/imapflow) connection per
  mailbox. IDLE on the first watched folder (a new mail fires within a second);
  the other folders, the unread counters (`STATUS UNSEEN`) and servers without
  IDLE are checked every 1 to 15 minutes. Reconnection after 5 s, 15 s, 30 s…
  up to 5 minutes; 30 minutes after a refused password, so that a provider does
  not lock the account.
- Only the UIDs above the last one seen fire. The first start, or a folder
  rebuilt by the server (new UIDVALIDITY), takes a baseline: nothing fires for
  the mails already there. After a restart, the mails received meanwhile fire,
  20 per folder at most.
- Nothing is marked as read: envelopes, structure and extract are fetched with
  `BODY.PEEK`; the extract comes from the first 4 KB of the first text part.
  Only the _Mark as read_ scene action writes a flag, after checking the
  UIDVALIDITY of the reference.
- `/data/imap-state.json` keeps the last UID and the UIDVALIDITY of each
  folder, nothing else. STARTTLS is required (never a fallback to clear text),
  certificates are verified, the IMAP responses are size-bounded.

## Checked on a real server, and what was not

Checked against [GreenMail](https://greenmail-mail-test.github.io/greenmail/)
2.1.5 in a Docker container, the integration running in the locked-down
sandbox of Gladys (read-only root, all capabilities dropped, 256 MB): a mail
sent by SMTP fires its trigger in 0.2 to 0.6 s through IDLE, a second folder is
read by the periodic check, the extract of a quoted-printable ISO-8859-1 part
is decoded, the unread count is unchanged after the checks, _Mark as read_
flags the right mail and refuses a stale reference, a wrong password, a
self-signed certificate and a server without STARTTLS are refused, and the
integration reconnects after a server restart. 25 MB of memory at rest.

Not checked: the real Gmail, Outlook and iCloud servers, a successful STARTTLS
upgrade (GreenMail does not offer it), and a real Gladys instance. Feedback
welcome on [the issues](https://github.com/guim31/gladys-imap/issues).

## Limitations

- Three mailboxes, five folders each; real time on the first folder only.
- The scene filters compare for equality: "subject contains" goes through the
  keywords of the configuration.
- No OAuth2, no attachments, no body beyond the extract, no sending.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and an in-memory IMAP server;
they never touch the network. See [CLAUDE.md](CLAUDE.md) for the project
rules.

## Credits

- [imapflow](https://github.com/postalsys/imapflow) by Postal Systems (MIT):
  the IMAP client.
- The Home Assistant [IMAP integration](https://www.home-assistant.io/integrations/imap/)
  (Apache-2.0): the idea of an event per mail with sender, subject and an
  extract, and of IDLE with a polling fallback. No code was copied.
- The `/data` store and the test layout come from
  [gladys-pihole](https://github.com/guim31/gladys-pihole),
  [gladys-gotify](https://github.com/guim31/gladys-gotify) and
  [gladys-wled](https://github.com/guim31/gladys-wled).
- The cover is a generic drawing, no third-party logo.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by any mail
provider. Gmail, Outlook and iCloud are trademarks of their owners.

## License

Apache-2.0
