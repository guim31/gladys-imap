// -----------------------------------------------------------------------------
// Dashboard widget "Latest mails" (manifest `widgets`, key `latest_mails`):
// the unread counter and the last mails received (sender, subject, time; never
// the body), for one mailbox or all of them.
//
// Budget of the core: 8 components, 1 focal, 2 texts, 1 status, 4 buttons.
// Here: 1 tile, 1 card-list (or 1 caption when empty), 1 status when a
// mailbox is unavailable.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { unreadFeatureId } from './devices.js';
import { RECENT_SIZE } from './mailbox.js';
import { WIDGET_TEXT, pick } from './texts.js';
import { WIDGET_KEY } from './hub.js';

export { WIDGET_KEY };

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function content(hub, { settings = {}, language = 'en' } = {}) {
  const selected = settings.mailbox ? hub.findMailbox(settings.mailbox) : undefined;
  const mailboxes = selected ? [selected] : hub.mailboxes;
  const components = [];

  if (selected) {
    components.push({
      type: 'value',
      label: pick(WIDGET_TEXT.unread, language),
      icon: 'mail',
      device_feature: unreadFeatureId(hub.gladys, selected),
    });
  } else if (mailboxes.some((mailbox) => mailbox.unread !== null)) {
    components.push({
      type: 'value',
      label: pick(WIDGET_TEXT.unread, language),
      icon: 'mail',
      value: mailboxes.reduce((total, mailbox) => total + (mailbox.unread ?? 0), 0),
    });
  }

  const mails = mailboxes
    .flatMap((mailbox) => mailbox.recent.map((mail) => ({ ...mail, mailbox })))
    .sort((a, b) => b.date - a.date)
    .slice(0, RECENT_SIZE);
  if (mails.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: mails.map((mail) => ({
        title: cut(mail.subject || pick(WIDGET_TEXT.no_subject, language), 60),
        subtitle: cut(
          mailboxes.length > 1 ? `${mail.fromName} · ${mail.mailbox.name}` : mail.fromName,
          80,
        ),
        date: mail.date.toISOString(),
      })),
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: pick(WIDGET_TEXT.empty, language) });
  }

  const down = mailboxes.filter((mailbox) => mailbox.lastErrorKind !== null);
  if (down.length > 0) {
    components.push({
      type: 'status',
      items: down.slice(0, 3).map((mailbox) => ({
        label: cut(mailbox.name, 40),
        value: cut(pick(WIDGET_TEXT.offline, language), 40),
        color: WIDGET_COLORS.DANGER,
      })),
    });
  }
  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get: (hub, request) => content(hub, request) },
};
