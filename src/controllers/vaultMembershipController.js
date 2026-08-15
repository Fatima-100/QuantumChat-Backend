import User from '../models/User.js';
import { toObjectId } from '../utils/toObjectId.js';

/**
 * Requires a valid vault-unlock token (Chunk 3 middleware attaches
 * req.vaultUnlocked). Until that middleware lands, these routes are
 * still auth-gated by requireAuth alone — do not expose vault contents
 * to the frontend before Chunk 3's middleware is wired in.
 */

export async function addToVault(req, res) {
  try {
    const { peerId } = req.body || {};
    const target = toObjectId(peerId);
    if (!target || target.equals(req.user._id)) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }

    const targetUser = await User.findById(target).select('_id isSystemUser');
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });
    if (targetUser.isSystemUser) {
      return res.status(400).json({ success: false, error: 'System users cannot be vaulted' });
    }

    const user = req.user;
    if (!user.vaultEnabled) {
      return res.status(400).json({ success: false, error: 'Set up a vault password before hiding chats' });
    }

    const already = (user.vaultedPeers || []).some((v) => String(v.peer) === String(target));
    if (!already) {
      user.vaultedPeers.push({ peer: target, addedAt: new Date() });
      await user.save();
    }

    res.json({ success: true, data: { vaulted: true, peerId: String(target) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function removeFromVault(req, res) {
  try {
    const target = toObjectId(req.params.peerId);
    if (!target) return res.status(400).json({ success: false, error: 'Invalid user id' });

    const user = req.user;
    const before = (user.vaultedPeers || []).length;
    user.vaultedPeers = (user.vaultedPeers || []).filter((v) => String(v.peer) !== String(target));
    if (user.vaultedPeers.length !== before) {
      await user.save();
    }

    res.json({ success: true, data: { vaulted: false, peerId: String(target) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Returns just the set of vaulted peer IDs — enough for the client to know
 * "is this conversation vaulted" without exposing any vaulted profile data
 * to a locked (unauthenticated-to-vault) session. Full peer details are
 * fetched separately, only after vault unlock (Chunk 3+).
 */
export async function listVaultedPeerIds(req, res) {
  const user = await User.findById(req.user._id).select('vaultedPeers');
  const ids = (user?.vaultedPeers || []).map((v) => String(v.peer));
  res.json({ success: true, data: ids });
}
import Message from '../models/Message.js';

/**
 * Reports whether a specific vaulted peer's decoy thread currently has any
 * messages — i.e. whether something was sent/received while locked. Only
 * answered when the caller's vault is currently unlocked (req.vaultUnlocked),
 * so a stolen session token without the short-lived vault token can't probe
 * which conversations have decoy content.
 */
export async function getPeerVaultDecoyStatus(req, res) {
  try {
    if (!req.vaultUnlocked) {
      return res.status(403).json({ success: false, error: 'Vault is locked' });
    }
    const peerId = toObjectId(req.params.peerId);
    if (!peerId) return res.status(400).json({ success: false, error: 'Invalid user id' });

    const user = await User.findById(req.user._id).select('vaultedPeers');
    const isVaulted = (user?.vaultedPeers || []).some((v) => String(v.peer) === String(peerId));
    if (!isVaulted) {
      return res.json({ success: true, data: { hasDecoyMessages: false, vaulted: false } });
    }

    const hasDecoyMessages = await Message.exists({
      decoyFor: req.user._id,
      $or: [
        { from: req.user._id, to: peerId },
        { from: peerId, to: req.user._id },
      ],
    });

    res.json({ success: true, data: { hasDecoyMessages: Boolean(hasDecoyMessages), vaulted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}