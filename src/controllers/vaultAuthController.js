import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const MIN_LEN = 6;

export async function getVaultStatus(req, res) {
  const user = await User.findById(req.user._id).select('vaultEnabled');
  res.json({ success: true, data: { vaultEnabled: Boolean(user?.vaultEnabled) } });
}

export async function setVaultPassword(req, res) {
  try {
    const { password, currentPassword } = req.body || {};
    if (typeof password !== 'string' || password.length < MIN_LEN) {
      return res.status(400).json({
        success: false,
        error: `Vault password must be at least ${MIN_LEN} characters`,
      });
    }

    const user = await User.findById(req.user._id).select('+vaultPasswordHash');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    // Changing an existing vault password requires the current one.
    if (user.vaultEnabled) {
      if (typeof currentPassword !== 'string') {
        return res.status(400).json({ success: false, error: 'currentPassword is required to change your vault password' });
      }
      const ok = await user.compareVaultPassword(currentPassword);
      if (!ok) {
        return res.status(403).json({ success: false, error: 'Current vault password is incorrect' });
      }
    }

    user.vaultPasswordHash = await bcrypt.hash(password, 10);
    user.vaultEnabled = true;
    await user.save();

    res.json({ success: true, data: { vaultEnabled: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function unlockVault(req, res) {
  try {
    const { password } = req.body || {};
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ success: false, error: 'password is required' });
    }

    const user = await User.findById(req.user._id).select('+vaultPasswordHash vaultEnabled');
    if (!user || !user.vaultEnabled) {
      return res.status(404).json({ success: false, error: 'Vault is not set up for this account' });
    }

    const ok = await user.compareVaultPassword(password);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Incorrect vault password' });
    }

    // Short-lived token, separate from the main session JWT. Verified by
    // requireVaultUnlock middleware (Chunk 3) on vaulted-conversation routes.
    const token = user.createVaultUnlockToken ? user.createVaultUnlockToken() : null;
    res.json({ success: true, data: { unlocked: true, vaultToken: token } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function disableVault(req, res) {
  try {
    const { password } = req.body || {};
    const user = await User.findById(req.user._id).select('+vaultPasswordHash vaultEnabled');
    if (!user?.vaultEnabled) {
      return res.status(400).json({ success: false, error: 'Vault is not enabled' });
    }
    const ok = await user.compareVaultPassword(password || '');
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Incorrect vault password' });
    }
    user.vaultEnabled = false;
    user.vaultPasswordHash = null;
    await user.save();
    res.json({ success: true, data: { vaultEnabled: false } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}