# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the IMAP passwords, stored by Gladys in the integration
  configuration (`secret` fields). The container never writes them to `/data`
  nor to the logs.
- **`/data`**: one file, `imap-state.json`, with the number of the last mail
  seen in each watched folder (UID and UIDVALIDITY). No address, no subject, no
  body.
- **Network**: outgoing connections only, to the configured IMAP servers, over
  TLS (port 993) or STARTTLS, which is required: a server that does not offer
  it is refused instead of carrying the password in clear. Certificates are
  verified unless the user ticks "Accept a self-signed certificate" for a
  mailbox. Responses are size-bounded, so a hostile server cannot exhaust the
  memory of the sandbox.
- **Mail contents**: the sender, subject and a 200-character extract of new
  mails are passed to Gladys scenes (the extract can be switched off); the
  latest headers are kept in memory for the widget. Mail contents are
  untrusted text and are never interpreted.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the mail servers the integration talks to.
