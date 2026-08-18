import jwt from 'jsonwebtoken';

function resolveExpiresIn(expiresIn) {
  return expiresIn || process.env.JWT_EXPIRES_IN || '30d';
}

export function generateToken(userId, options = {}) {
  const payload = { id: userId };
  if (options.sessionId) {
    payload.sessionId = String(options.sessionId);
  }
  return jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: resolveExpiresIn(options.expiresIn),
  });
}

/** Short-lived token used only to complete TOTP verification after password login. */
export function generate2faTempToken(userId) {
  return jwt.sign({ id: userId, purpose: '2fa' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

export function rememberMeExpiresIn() {
  return process.env.JWT_REMEMBER_EXPIRES_IN || '90d';
}
