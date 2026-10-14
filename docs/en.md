# IMAP Mail

Turn the mails you receive into Gladys scene triggers: watch up to three IMAP mailboxes, react to a mail from a given sender, domain or folder, or whose subject contains a keyword, and pass its sender, subject and a short extract to the scene. Each mailbox also becomes a device with its unread counter, and a dashboard widget lists the latest mails.

This integration **receives** mails. To **send** mails from Gladys, use the official [SMTP integration](https://github.com/GladysAssistant/gladys-smtp) (gladys-smtp).

Tested against a GreenMail test server, not yet against every provider: feedback welcome on [the issues](https://github.com/guim31/gladys-imap/issues).

## What the integration does

- **Real time**: the first watched folder of each mailbox is followed with IMAP IDLE, a new mail fires its trigger within a second or two. The other folders, and servers without IDLE, are checked at the chosen interval.
- **Read only**: nothing is sent, moved, deleted or marked as read, except by the "Mark as read" scene action when a scene asks for it. The mails are read with `BODY.PEEK`, which leaves them unread.
- **Only new mails**: at the first start, the mails already in the box fire nothing. After a restart, the mails received meanwhile fire (20 per folder at most, the newest).
- **Nothing kept**: the integration stores only the number of the last mail seen in each folder, under `/data`. No subject, no sender, no body.

## Requirements

- Gladys Assistant 5.1 or later.
- An IMAP account reachable from Gladys: the server address, the user (usually the mail address) and the password.
- **Gmail, Outlook, iCloud, Yahoo**: an **app password**, created in the security settings of the account (two-step verification must be on). The normal password is refused by these providers. OAuth2 sign-in is not supported.

## Configuration

In **Integrations → IMAP Mail → Configuration**, fill in one block per mailbox (up to three):

| Field                            | Meaning                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| IMAP server                      | e.g. `imap.gmail.com`, `outlook.office365.com`, `imap.mail.me.com`. Leave empty to disable the block. |
| Port                             | 993 for TLS (default), 143 for STARTTLS.                                                              |
| Security                         | TLS or STARTTLS. A server offering neither is refused: the password never travels in clear.           |
| User                             | Usually the full mail address.                                                                        |
| Password                         | The (app) password. Stored by Gladys as a secret, never written in the logs.                          |
| Folders to watch                 | Comma-separated, 5 at most, `INBOX` by default. The first one is real time.                           |
| Accept a self-signed certificate | Only for a server of your own whose certificate you created yourself.                                 |

Then the options:

- **Subject keywords**: comma-separated words (e.g. `invoice, parcel, alarm`). A mail whose subject contains one fires "Keyword in a mail subject". Case and accents are ignored.
- **Pass a short extract to the scenes**: the first 200 characters of the text of the mail (on by default). Off, only the sender and the subject leave the mail server.
- **Full check every**: 1, 2 (default), 5 or 15 minutes, for the other folders and the unread counters.
- **Language of the names and messages**: French by default.

Save, then click **Test the connection**: one line per mailbox, with its unread count or the reason of the failure.

### Providers

| Provider    | Server                  | Port, security |
| ----------- | ----------------------- | -------------- |
| Gmail       | `imap.gmail.com`        | 993, TLS       |
| Outlook.com | `outlook.office365.com` | 993, TLS       |
| iCloud      | `imap.mail.me.com`      | 993, TLS       |
| Yahoo       | `imap.mail.yahoo.com`   | 993, TLS       |
| Orange      | `imap.orange.fr`        | 993, TLS       |
| Free        | `imap.free.fr`          | 993, TLS       |

Gmail reads its labels as folders: `[Gmail]/Spam`, a label `Alerts` is the folder `Alerts`.

## Devices

In **Integrations → IMAP Mail → Discovery**, each configured mailbox appears as a device named after its address, with one feature: the number of **unread mails** in its watched folders. Add it to Gladys to see it on the dashboard, chart it, or use it in a scene condition ("more than 10 unread"). It follows the changes made elsewhere (a mail read on your phone) within the check interval, at once for the first folder.

## Scene triggers

In a scene, choose **Integrations**, then one of these triggers. A filter left empty means "any".

### Mail received

A new mail arrived in a watched folder. Filters: the mailbox, the **sender address** (exact, in lower case), the **sender domain** (what follows the @, in lower case) and the **folder** (as written in the configuration).

### Keyword in a mail subject

A new mail whose subject contains one of the subject keywords of the configuration. Filters: the mailbox, the **keyword** (written as in the configuration; empty: any) and the sender address. A subject containing two keywords fires the trigger twice, once per keyword.

### Information passed on to the scene

Both triggers pass on: Mailbox, Folder, Sender name, Sender address, Subject, Extract (empty when switched off), Received at (local time, `2026-10-14 08:05`) and Mail reference (for the "Mark as read" action). "Keyword in a mail subject" adds the Keyword found. Insert them in a message with the variable picker.

## Scene actions

### Read the unread count

Asks the server for the number of unread mails of a mailbox, at once. Its result, "Unread mails", can be used in a condition or a message of the following actions.

### Mark as read

Marks the mail of the trigger as read. Choose the mailbox and put the **Mail reference** variable of the trigger in the "Mail reference" field. Only that mail is touched; if the folder was rebuilt by the server meanwhile, the action fails rather than touch another mail. Result: "Marked as read".

## Widget

Add the **Latest mails** widget to a dashboard: the unread counter and the last 8 mails received (sender, subject, time; never the body). Choose a mailbox in its settings, or leave it empty to see them all. A mailbox the server refuses shows a red line.

## Examples of scenes

- **Parcel delivered**: keyword `delivered` in the configuration; trigger "Keyword in a mail subject" (keyword `delivered`); action "Send a message": "📦 {{Subject}} — {{Extract}}".
- **Alarm by mail**: trigger "Mail received", sender address `alerts@my-nas.example`; actions: turn on the hall light, send a notification with the subject; then "Mark as read" with the Mail reference.
- **Morning summary**: trigger "Every day at 7:30"; action "Read the unread count"; condition "Unread mails" greater than 0; message "You have {{Unread mails}} unread mails".

## Troubleshooting

- **"login refused"**: check the user and the password. Gmail, Outlook and iCloud need an app password. After a refused password, the integration waits 30 minutes before trying again (some providers lock the account after repeated failures): save the configuration to retry at once.
- **"secure connection failed"**: the port and the security do not match (993 with TLS, 143 with STARTTLS), or the certificate is self-signed: tick "Accept a self-signed certificate" only for a server of your own.
- **"the mail server does not answer"**: wrong server address, or Gladys has no Internet access. The integration reconnects by itself, with a growing delay up to 5 minutes.
- **"Folders not found"**: the folder name must be the one of the server, with its parent (`Work/Alerts` or `Work.Alerts` depending on the server).
- **No trigger for an old mail**: on purpose, only the mails arriving after the first start fire.
- **A mail moved into a watched folder** counts as a new mail there.
- Detailed logs: set the `LOG_LEVEL=debug` environment variable; senders and subjects then appear in the logs, never the password.

## Limits

- Three mailboxes, five folders per mailbox.
- Real time on the first folder only; the others follow the check interval.
- The filters of the scene editor compare for equality: "subject contains" goes through the keywords of the configuration.
- No OAuth2 sign-in (Gmail and Microsoft accounts need an app password; some Microsoft 365 work accounts disable them).
- No attachment, no body beyond the 200-character extract, no sending (see gladys-smtp).
- The mail server is a remote service: the integration depends on it and on the Internet connection.
