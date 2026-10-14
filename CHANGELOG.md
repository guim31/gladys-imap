# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-14

### Added

- Watch up to three IMAP mailboxes (TLS or required STARTTLS, app passwords),
  up to five folders each: the first one in real time (IDLE), the others at a
  chosen interval. Reconnection with a growing delay.
- Scene trigger "Mail received", filtered by mailbox, sender address, sender
  domain and folder; scene trigger "Keyword in a mail subject" for the keywords
  of the configuration. Both pass the sender, subject, a short extract
  (optional), the reception time and a mail reference to the scene.
- One device per mailbox with its unread counter.
- Scene actions "Read the unread count" and "Mark as read" (the mail of the
  trigger only).
- Dashboard widget "Latest mails": unread counter and the last mails (sender,
  subject, time).
- "Test the connection" action, documentation in English, French, German and
  Spanish.
- Nothing is marked as read by the checks (BODY.PEEK), no body is stored, only
  the mails arriving after the first start fire.

[Unreleased]: https://github.com/guim31/gladys-imap/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-imap/releases/tag/v1.0.0
