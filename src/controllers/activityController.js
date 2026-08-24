import Message from '../models/Message.js';
import Group from '../models/Group.js';
import FriendRequest from '../models/FriendRequest.js';
import { notExpiredFilter } from '../utils/messageExpiry.js';

// Same lookback/overlap pattern as messageController.js's syncMessages —
// cap how far back a first sync can reach, and roll the returned cursor
// back slightly so a write landing in the same instant as the query isn't
// silently skipped on the next poll.
const SYNC_FLOOR_MS = 24 * 60 * 60 * 1000;
const SYNC_OVERLAP_MS = 5000;

function labelFor(userDoc) {
  if (!userDoc) return 'Someone';
  return userDoc.displayName || userDoc.username || 'Someone';
}

/**
 * Polling fallback for the activity feed on deployments where Socket.IO
 * cannot run (serverless / Vercel). Derives the same four event types the
 * socket handlers in Chat.jsx normally construct — friend requests,
 * group create/update, reactions, mentions — directly from existing
 * collections. No new schema/collection required.
 *
 * Intentionally NOT covering group *deletion*: once a group is deleted the
 * caller is no longer a member, so it drops out of the `members: uid`
 * query with no trace to diff against. Socket-based deletion events are
 * unaffected; this is a gap specific to the polling fallback.
 */
export async function syncActivity(req, res) {
  try {
    const uid = req.user._id;
    const requested = req.query.since ? new Date(req.query.since) : null;
    const now = Date.now();
    const floor = now - SYNC_FLOOR_MS;
    const since =
      requested && !Number.isNaN(requested.getTime())
        ? new Date(Math.min(Math.max(requested.getTime(), floor), now))
        : new Date(floor);

    const groupIds = await Group.find({ members: uid }).distinct('_id');
    const events = [];

    // 1. Friend requests received (pending, sent to me)
    const friendRequests = await FriendRequest.find({
      to: uid,
      status: 'pending',
      createdAt: { $gt: since },
    }).populate('from', 'username displayName');

    for (const r of friendRequests) {
      events.push({
        id: String(r._id),
        type: 'friend_request',
        actorId: String(r.from._id),
        actorLabel: labelFor(r.from),
        actorIsCurrentUser: false,
        targetId: String(uid),
        at: r.createdAt,
      });
    }

    // 2. Groups I'm in that were created or updated
    const groups = await Group.find({
      members: uid,
      updatedAt: { $gt: since },
    }).select('name createdAt updatedAt createdBy');

    for (const g of groups) {
      const isNew = g.createdAt.getTime() > since.getTime();
      events.push({
        id: `${isNew ? 'new' : 'updated'}:${g._id}`,
        type: 'group',
        groupId: String(g._id),
        groupName: g.name,
        action: isNew ? 'created' : 'updated',
        targetId: String(g._id),
        actorId: g.createdBy ? String(g.createdBy) : undefined,
        at: g.updatedAt,
      });
    }

    // 3. Reactions on messages I'm a party to (DM or group member).
    // Reactions live inside an existing message's reactions[] array, so
    // this can't be found via "createdAt > since" the way new messages
    // can — it has to filter on the reaction's own timestamp.
    const reactionMessages = await Message.find({
      $and: [
        { $or: [{ from: uid }, { to: uid }, { group: { $in: groupIds } }] },
        { 'reactions.createdAt': { $gt: since } },
        notExpiredFilter(),
      ],
    })
      .select('from group reactions')
      .populate('reactions.user', 'username displayName')
      .populate('from', 'username displayName');

    for (const m of reactionMessages) {
      for (const r of m.reactions || []) {
        if (!r.createdAt || r.createdAt.getTime() <= since.getTime()) continue;
        const reactorId = String(r.user?._id || r.user);
        const reactedByMe = reactorId === String(uid);
        const fromId = String(m.from?._id || m.from);
        events.push({
          id: `${m._id}:${reactorId}:${r.createdAt.getTime()}`,
          type: 'reaction',
          messageId: String(m._id),
          targetId: String(m._id),
          actorId: reactorId,
          actorLabel: reactedByMe ? 'you' : labelFor(r.user),
          actorIsCurrentUser: reactedByMe,
          originalAuthorLabel: fromId === String(uid) ? 'your' : `${labelFor(m.from)}'s`,
          originalAuthorIsCurrentUser: fromId === String(uid),
          groupId: m.group ? String(m.group) : undefined,
          conversationKey: m.group ? `group:${m.group}` : undefined,
          at: r.createdAt,
        });
      }
    }

    // 4. Messages that mention me (set once at creation, so createdAt
    // filtering — same as messageController.js's syncMessages — is safe here)
    const mentionMessages = await Message.find({
      mentionedUserIds: uid,
      createdAt: { $gt: since },
      from: { $ne: uid },
    })
      .select('from group createdAt')
      .populate('from', 'username displayName')
      .populate('group', 'name');

    for (const m of mentionMessages) {
      const groupId = m.group ? String(m.group._id || m.group) : undefined;
      events.push({
        id: String(m._id),
        type: 'mention',
        messageId: String(m._id),
        targetId: groupId,
        actorId: String(m.from?._id || m.from),
        actorLabel: labelFor(m.from),
        actorIsCurrentUser: false,
        groupId,
        groupName: m.group?.name,
        conversationKey: groupId ? `group:${groupId}` : undefined,
        at: m.createdAt,
      });
    }

    events.sort((a, b) => new Date(a.at) - new Date(b.at));

    res.json({
      success: true,
      data: events,
      meta: {
        cursor: new Date(Date.now() - SYNC_OVERLAP_MS).toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}