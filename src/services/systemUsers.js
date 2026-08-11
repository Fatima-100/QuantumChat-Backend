import crypto from 'crypto';
import User, { KEY_SET_SIZE } from '../models/User.js';

/**
 * Idempotently ensures a singleton system/bot User exists for the given
 * systemRole. Any pre-existing human account that collides on username or
 * email is renamed out of the way first, since systemRole is immutable and
 * can't be bolted onto an existing user.
 */
export async function ensureSystemUser({ systemRole, username, email, displayName, privacy }) {
  const existing = await User.findOne({ systemRole });
  if (existing) return existing;

  const collision = await User.findOne({
    $or: [{ username: { $regex: `^${username}$`, $options: 'i' } }, { email }],
  });
  if (collision) {
    const suffix = String(collision._id).slice(-6);
    await User.updateOne(
      { _id: collision._id, isSystemUser: { $ne: true } },
      {
        $set: {
          username: `${username}-legacy-${suffix}`,
          ...(collision.email === email
            ? { email: `${username.toLowerCase()}-legacy-${suffix}@system.quantumchat` }
            : {}),
        },
      }
    );
  }

  try {
    return await User.create({
      username,
      displayName,
      email,
      emailVerified: true,
      publicKeys: Array.from({ length: KEY_SET_SIZE }, () => crypto.randomBytes(32).toString('hex')),
      isSystemUser: true,
      systemRole,
      verified: true,
      privacy: privacy || { lastSeen: 'nobody', online: 'nobody', readReceipts: false },
    });
  } catch (error) {
    if (error?.code === 11000) {
      const raced = await User.findOne({ systemRole });
      if (raced) return raced;
    }
    throw error;
  }
}
