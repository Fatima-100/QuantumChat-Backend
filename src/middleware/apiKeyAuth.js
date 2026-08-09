import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import ApiKey from '../models/ApiKey.js';

export const API_KEY_PREFIX = 'qlk_';

export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey() {
  return `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
}

/** Blunt IP-based brute force against unknown keys, before any DB lookup. */
export const publicApiIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: { success: false, error: 'Too many requests, please try again shortly' },
});

/** Per-partner throughput cap, applied once the key is known good. */
export const publicApiKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.apiKey._id),
  message: { success: false, error: 'Too many requests for this API key, please try again shortly' },
});

export async function requireApiKey(req, res, next) {
  try {
    const header = req.headers['x-api-key'];
    const key = typeof header === 'string' ? header.trim() : '';
    if (!key || !key.startsWith(API_KEY_PREFIX)) {
      return res.status(401).json({ success: false, error: 'Missing or invalid API key' });
    }
    const record = await ApiKey.findOneAndUpdate(
      { keyHash: hashApiKey(key), active: true },
      { $set: { lastUsedAt: new Date() } },
      { new: true }
    );
    if (!record) {
      return res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
    }
    req.apiKey = record;
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: 'API key verification failed' });
  }
}

export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey?.scopes?.includes(scope)) {
      return res.status(403).json({ success: false, error: `API key is missing required scope: ${scope}` });
    }
    next();
  };
}
