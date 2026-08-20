const HEX_64 = /^[0-9a-f]{64}$/i;

/** Sealed-box envelope shape used for call signaling (matches Message envelopes). */
export function isSealedEnvelope(envelope) {
  return (
    envelope &&
    typeof envelope.ciphertext === 'string' &&
    envelope.ciphertext.length > 0 &&
    typeof envelope.nonce === 'string' &&
    envelope.nonce.length > 0 &&
    HEX_64.test(envelope.ephemeralPublicKey || '') &&
    HEX_64.test(envelope.targetPublicKey || '')
  );
}

/** Reject legacy plaintext WebRTC signaling fields. */
export function hasForbiddenPlaintextSignaling(payload = {}) {
  if (payload.sdp != null) return true;
  if (payload.candidate != null) return true;
  if (typeof payload.video === 'boolean' && !payload.envelope) return false;
  return false;
}

/**
 * Checks whether `senderId` is permitted to invite `recipientId` to a call or meeting,
 * taking into account blocking (both directions) and recipient privacy (whoCanMessage).
 */
export async function canUserInviteToCall(senderId, recipientId) {
  const { default: User } = await import('../models/User.js');
  const { areUsersBlocked } = await import('../controllers/userController.js');
  const { toObjectId } = await import('./toObjectId.js');

  const senderOid = toObjectId(senderId);
  const recipientOid = toObjectId(recipientId);
  if (!senderOid || !recipientOid) return false;
  if (senderOid.equals(recipientOid)) return true;

  const recipient = await User.findById(recipientOid).select('blockedUsers friends privacy username');
  if (!recipient) return false;

  if (await areUsersBlocked(senderOid, recipientOid, recipient.blockedUsers)) {
    return false;
  }

  const policy = recipient.privacy?.whoCanMessage || 'everyone';
  if (policy === 'everyone') return true;

  const recipientFriends = (recipient.friends || []).map((f) => String(f._id || f));
  const senderIsFriend = recipientFriends.includes(String(senderOid));

  if (policy === 'friends') {
    return senderIsFriend;
  }

  if (policy === 'friendsOfFriends') {
    if (senderIsFriend) return true;
    const sender = await User.findById(senderOid).select('friends');
    const senderFriends = new Set((sender?.friends || []).map((f) => String(f._id || f)));
    return recipientFriends.some((id) => senderFriends.has(id));
  }

  return true;
}

