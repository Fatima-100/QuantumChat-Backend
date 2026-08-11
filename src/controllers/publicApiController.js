import Message from '../models/Message.js';
import User from '../models/User.js';
import { sealForPublicKey } from '../utils/sealedBox.js';
import { ensureQuantumLogicsSystemUser } from '../services/quantumLogicsSystemUser.js';
import { isUserOnline } from '../socket/index.js';
import { notifyUser } from '../services/pushService.js';
import { toObjectId } from '../utils/toObjectId.js';

const MAX_CONTENT_LENGTH = 2000;
const MAX_TITLE_LENGTH = 120;

/**
 * Partner sites identify the recipient by whichever of userId/username/email
 * they already have on hand — QuantumChat account creation always requires
 * client-generated encryption keys, so partners can't provision accounts
 * through this API, only message into ones that already exist.
 */
function buildRecipientQuery({ userId, username, email }) {
  if (userId) {
    const oid = toObjectId(userId);
    return oid ? { _id: oid } : null;
  }
  if (username) return { username: String(username).trim() };
  if (email) return { email: String(email).trim().toLowerCase() };
  return null;
}

export async function sendSystemMessage(req, res) {
  try {
    const { userId, username, email, content, title } = req.body || {};
    if (typeof content !== 'string' || !content.trim() || content.length > MAX_CONTENT_LENGTH) {
      return res
        .status(400)
        .json({ success: false, error: `content is required (1-${MAX_CONTENT_LENGTH} chars)` });
    }
    if (title != null && (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH)) {
      return res
        .status(400)
        .json({ success: false, error: `title must be a string up to ${MAX_TITLE_LENGTH} chars` });
    }

    const query = buildRecipientQuery({ userId, username, email });
    if (!query) {
      return res
        .status(400)
        .json({ success: false, error: 'Provide exactly one of userId, username, or email, identifying an existing user' });
    }

    const recipient = await User.findOne(query).select('publicKeys blockedUsers');
    if (!recipient) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const recipientKeys = (recipient.publicKeys || []).filter(Boolean);
    if (!recipientKeys.length) {
      return res.status(409).json({ success: false, error: 'Recipient has no encryption keys on file' });
    }

    const sender = await ensureQuantumLogicsSystemUser();
    const isBlocked = (recipient.blockedUsers || []).some((id) => String(id) === String(sender._id));
    if (isBlocked) {
      return res.status(403).json({ success: false, error: 'Recipient has blocked system messages' });
    }

    const body = title ? `${title.trim()}\n\n${content.trim()}` : content.trim();
    const senderKeys = (sender.publicKeys || []).filter(Boolean);

    const message = await Message.create({
      from: sender._id,
      to: recipient._id,
      forRecipient: sealForPublicKey(body, recipientKeys[0]),
      forSender: sealForPublicKey(body, senderKeys[0]),
      kind: 'system',
    });

    const io = req.app.get('io');
    if (io) {
      io.to(String(recipient._id)).emit('message:new', {
        ...message.toObject(),
        id: message._id,
      });
    }
    if (!isUserOnline(recipient._id)) {
      notifyUser(recipient._id, { title: 'QuantumChat', body: 'New message' }).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      data: { messageId: message._id, to: String(recipient._id), createdAt: message.createdAt },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Failed to send message' });
  }
}
