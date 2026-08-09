import mongoose from 'mongoose';

const apiKeySchema = new mongoose.Schema(
  {
    // Which partner site this key belongs to, e.g. "QuantumCommunity".
    name: { type: String, required: true, trim: true, maxlength: 60 },
    keyHash: { type: String, required: true, unique: true },
    // First few chars of the plaintext key, kept for admin identification —
    // the full key is never stored.
    keyPrefix: { type: String, required: true },
    scopes: { type: [String], default: ['messages:send'] },
    active: { type: Boolean, default: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('ApiKey', apiKeySchema, 'apikeys');
