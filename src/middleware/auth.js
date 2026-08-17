import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Missing authorization token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.purpose === '2fa') {
      return res.status(401).json({ success: false, error: '2FA verification required' });
    }
    const user = await User.findById(payload.id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}
/**
 * Lighter auth for high-frequency, read-only endpoints (presence heartbeat,
 * message sync polling). Returns a plain object via .lean() — do NOT use
 * this on any route that calls req.user.save() or markModified(); use
 * requireAuth for those instead.
 */
export async function requireAuthLean(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Missing authorization token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.purpose === '2fa') {
      return res.status(401).json({ success: false, error: '2FA verification required' });
    }
    const user = await User.findById(payload.id)
      .select('_id username blockedUsers friends mutedChats notificationSettings vaultedPeers privacy publicKeys')
      .lean();
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}