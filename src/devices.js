// -----------------------------------------------------------------------------
// One Gladys device per mailbox, with one feature: the number of unread mails
// in its watched folders. The states are pushed by the container (IDLE and the
// periodic check): should_poll stays false.
// -----------------------------------------------------------------------------

import { FEATURE_UNREAD, pick } from './texts.js';

export const DEVICE_TYPE = 'mailbox';
export const FEATURE_UNREAD_KEY = 'unread';
// Display bounds only (the core never clamps): a large mailbox can hold more.
export const UNREAD_MAX = 100_000;

/**
 * @param {object} gladys GladysIntegration
 * @param {{ id: string, name: string }} mailbox src/mailbox.js
 * @param {string} language
 */
export function buildDevice(gladys, mailbox, language) {
  const ids = gladys.externalIds(DEVICE_TYPE, mailbox.id);
  return {
    name: mailbox.name,
    external_id: ids.device,
    should_poll: false,
    features: [
      {
        name: pick(FEATURE_UNREAD, language),
        external_id: ids.feature(FEATURE_UNREAD_KEY),
        category: 'counter-sensor',
        type: 'integer',
        read_only: true,
        has_feedback: false,
        min: 0,
        max: UNREAD_MAX,
      },
    ],
  };
}

export function unreadFeatureId(gladys, mailbox) {
  return gladys.externalIds(DEVICE_TYPE, mailbox.id).feature(FEATURE_UNREAD_KEY);
}

export function deviceId(gladys, mailbox) {
  return gladys.externalIds(DEVICE_TYPE, mailbox.id).device;
}
