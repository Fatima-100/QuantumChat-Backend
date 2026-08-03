import Message from '../models/Message.js';
import Story from '../models/Story.js';
import Group from '../models/Group.js';
import Attachment from '../models/Attachment.js';
import { getStorage } from '../middleware/upload.js';
import User from '../models/User.js';
import { conversationKey } from '../utils/conversationKey.js';
async function removeAttachmentFiles(attachmentId) {
  if (!attachmentId) return;
  const attachment = await Attachment.findById(attachmentId);
  if (!attachment) return;
  const storage = getStorage();
  try {
    await storage.delete(attachment.storagePath);
    if (attachment.forSenderStoragePath) {
      await storage.delete(attachment.forSenderStoragePath);
    }
  } catch {
    // best-effort
  }
  await Attachment.deleteOne({ _id: attachment._id });
}

export async function purgeExpiredMessages(io) {
  const now = new Date();
  const expired = await Message.find({ expiresAt: { $lte: now, $ne: null } }).limit(200);
  if (!expired.length) return 0;

  for (const message of expired) {
    const id = message._id.toString();
   const payload = { id, conversation: conversationKey({ group: message.group, from: message.from, to: message.to }) };

    try {
      await removeAttachmentFiles(message.attachment);
    } catch {
      // best-effort
    }
    await Message.deleteOne({ _id: message._id });

    if (!io) continue;

    if (message.group) {
      try {
        const group = await Group.findById(message.group).select('members');
        if (group?.members?.length) {
          for (const memberId of group.members) {
            io.to(String(memberId)).emit('message:expired', payload);
          }
        }
      } catch {
        io.emit('message:expired', payload);
      }
    } else {
      const from = String(message.from);
      const to = message.to ? String(message.to) : null;
      io.to(from).emit('message:expired', payload);
      if (to && to !== from) io.to(to).emit('message:expired', payload);
    }
  }

  return expired.length;
}

export async function purgeExpiredStories(io) {
  const now = new Date();
  const expired = await Story.find({ expiresAt: { $lte: now } }).limit(100);
  if (!expired.length) return 0;

  const storage = getStorage();
  for (const story of expired) {
    const id = story._id.toString();
    try {
      await storage.delete(story.storagePath);
    } catch {
      // best-effort
    }
    await Story.deleteOne({ _id: story._id });
    if (io) io.emit('story:deleted', { id });
  }

  return expired.length;
}
export async function purgeExpiredMutes() {
  const now = new Date();
  const users = await User.find({
    mutedChats: { $elemMatch: { expiresAt: { $ne: null, $lte: now } } },
  }).select('mutedChats');

  if (!users.length) return 0;

  let cleared = 0;
  for (const user of users) {
    const before = user.mutedChats.length;
    user.mutedChats = user.mutedChats.filter(
      (m) => m.expiresAt == null || m.expiresAt > now
    );
    cleared += before - user.mutedChats.length;
    await user.save();
  }

  return cleared;
}

export async function runExpiryJobs(io) {
  const [messages, stories, mutes] = await Promise.all([
    purgeExpiredMessages(io).catch((err) => {
      console.error('purgeExpiredMessages failed:', err.message);
      return 0;
    }),
    purgeExpiredStories(io).catch((err) => {
      console.error('purgeExpiredStories failed:', err.message);
      return 0;
    }),
    purgeExpiredMutes().catch((err) => {
      console.error('purgeExpiredMutes failed:', err.message);
      return 0;
    }),
  ]);
  return { messages, stories, mutes };
}
