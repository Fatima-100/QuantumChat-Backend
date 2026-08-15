import jwt from 'jsonwebtoken';

/**
 * Non-blocking: attaches req.vaultUnlocked = true only if a valid,
 * unexpired vault-unlock token for the *current authenticated user*
 * is present. Never rejects the request — routes decide what to do
 * with req.vaultUnlocked (e.g. real vs decoy message filtering).
 */
export function readVaultUnlock(req, _res, next) {
  req.vaultUnlocked = false;
  try {
    const token = req.headers['x-vault-token'];
    if (!token || !req.user) return next();
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.scope === 'vault' && String(payload.sub) === String(req.user._id)) {
      req.vaultUnlocked = true;
    }
  } catch {
    // invalid/expired token → stays locked, no error surfaced
  }
  next();
}