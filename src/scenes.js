// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`). The handlers receive the RESOLVED
// fields (scene variables substituted by the core) and return the declared
// outputs. Neither one fires a scene event: no loop through the integration.
// -----------------------------------------------------------------------------

import { parseMessageRef } from './message.js';

export const SCENE_ACTIONS = {
  /** The live unread counter of one mailbox, for a condition or a message. */
  get_unread_count: async (hub, { fields }) => ({
    unread: await hub.readUnread(fields.mailbox),
  }),

  /** Flags the mail a trigger passed on ("Mail reference") as read. */
  mark_as_read: async (hub, { fields }) => ({
    marked: await hub.markAsRead(fields.mailbox, parseMessageRef(fields.message_ref)),
  }),
};
