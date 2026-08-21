import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { normalizeNotificationSettings } from '../utils/notificationSettings.js';
const HEX_64 = /^[0-9a-f]{64}$/i;
export const KEY_SET_SIZE = 5;

const privacySchema = new mongoose.Schema(
  {
    lastSeen: {
      type: String,
      enum: ['everyone', 'friends', 'nobody'],
      default: 'everyone',
    },
    /** Legacy presence gate used by sockets (`everyone` | `nobody`). */
    online: { type: String, enum: ['everyone', 'nobody'], default: 'everyone' },
    onlineStatus: {
      type: String,
      enum: ['everyone', 'friends', 'selected'],
      default: 'everyone',
    },
    onlineStatusVisibleTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    /** Boolean (legacy) or `everyone` | `friends` | `nobody`. */
    readReceipts: { type: mongoose.Schema.Types.Mixed, default: 'everyone' },
    /** When false, this user does not broadcast typing indicators to peers. */
    typingIndicator: { type: Boolean, default: true },
    whoCanMessage: {
      type: String,
      enum: ['everyone', 'friends', 'friendsOfFriends'],
      default: 'everyone',
    },
    discoverable: {
      type: String,
      enum: ['everyone', 'nobody'],
      default: 'everyone',
    },
    story: {
      type: String,
      enum: ['everyone', 'friends', 'nobody', 'selected'],
      default: 'everyone',
    },
    storyViewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { _id: false }
);
const notificationSettingsSchema = new mongoose.Schema(
  {
    messageNotifications: {
      type: String,
      enum: ['all', 'direct_only', 'all_except_reactions'],
      default: 'all',
    },
    statusNotifications: {
      type: String,
      enum: ['all', 'favorites_only', 'off'],
      default: 'all',
    },
    soundEnabled: { type: Boolean, default: true },
    soundVolume: { type: Number, min: 0, max: 100, default: 80 },
    messagePreview: {
      type: String,
      enum: ['full', 'sender_only', 'hidden'],
      default: 'full',
    },
    vibration: {
      type: String,
      enum: ['on', 'off', 'custom'],
      default: 'on',
    },
     /** Whether this user wants a reminder 5 minutes before a friend's birthday begins. */
    birthdayReminders: { type: Boolean, default: true },
    doNotDisturb: {
      enabled: { type: Boolean, default: false },
      startTime: { type: String, default: '22:00' },
      endTime: { type: String, default: '07:00' },
      allowedContacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },
    groupNotifications: {
      type: String,
      enum: ['all', 'mentions_only', 'important_only', 'off'],
      default: 'all',
    },
    callNotifications: {
      voiceCallEnabled: { type: Boolean, default: true },
      videoCallEnabled: { type: Boolean, default: true },
      vibrateOnCall: { type: Boolean, default: true },
      missedCallReminders: { type: Boolean, default: true },
    },
    badgeCount: {
      type: String,
      enum: ['show', 'hidden'],
      default: 'show',
    },
    webNotifications: {
      enabled: { type: Boolean, default: true },
      soundOnWeb: { type: Boolean, default: true },
      syncReadAcrossDevices: { type: Boolean, default: true },
    },
    priority: {
      type: String,
      enum: ['high', 'normal', 'silent'],
      default: 'normal',
    },
  },
  { _id: false }
);
const mutedChatSchema = new mongoose.Schema(
  {
    conversationKey: { type: String, required: true },
    expiresAt: { type: Date, default: null }, // null = muted forever ("Always")
  },
  { _id: false }
);
const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '',
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 32,
      default: '',
    },
     dateOfBirth: {
      type: Date,
      default: null,
    },
    /** IANA timezone name, auto-captured client-side (e.g. 'Asia/Karachi'). Used to schedule birthday notifications in the user's local time. */
    timezone: {
      type: String,
      trim: true,
      maxlength: 64,
      default: 'UTC',
    },
    /** Internal — prevents the birthday job from notifying friends twice in the same year. Never exposed via JSON. */
    lastBirthdayNotifiedYear: {
      type: Number,
      default: null,
      select: false,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerifyToken: { type: String, select: false },
    emailVerifyExpires: { type: Date, select: false },
    password: {
      type: String,
      required() {
        return !this.isSystemUser;
      },
      select: false,
    },
    isSystemUser: {
      type: Boolean,
      default: false,
      immutable: true,
      index: true,
    },
    systemRole: {
      type: String,
      enum: ['quantum_ai', 'quantum_logics'],
      immutable: true,
    },
    verified: {
      type: Boolean,
      default: false,
      immutable: true,
    },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
   totpSecret: { type: String, select: false },
    totpEnabled: { type: Boolean, default: false },
   vaultPasswordHash: { type: String, select: false, default: null },
    vaultEnabled: { type: Boolean, default: false },
    vaultedPeers: [
      {
        peer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    publicKeys: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length === KEY_SET_SIZE && arr.every((k) => HEX_64.test(k)),
        message: `publicKeys must contain exactly ${KEY_SET_SIZE} 64-character hex public keys`,
      },
    },
    keyRotatedAt: {
      type: Date,
      default: Date.now,
    },
    lastLoginAt: {
      type: Date,
    },
    /** Last REST/socket presence heartbeat — used when Socket.IO is unavailable (e.g. Vercel). */
    presenceAt: {
      type: Date,
      default: null,
      index: true,
    },
    typingTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    typingGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    typingAt: {
      type: Date,
      default: null,
    },
    privacy: {
      type: privacySchema,
      default: () => ({}),
    },
    notificationSettings: {
      type: notificationSettingsSchema,
      default: () => ({}),
    },
    mutedChats: {
      type: [mutedChatSchema],
      default: [],
    },
    blockedUsers: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
],
friends: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
],
    
    avatarPath: {
      type: String,
      default: null,
    },
    avatarStorageProvider: {
      type: String,
      enum: ['local', 'google-drive'],
      default: null,
    },
    avatarMimeType: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  if (!this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.compareVaultPassword = function compareVaultPassword(candidate) {
  if (!this.vaultPasswordHash) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.vaultPasswordHash);
};
userSchema.methods.createVaultUnlockToken = function createVaultUnlockToken() {
  return jwt.sign(
    { sub: String(this._id), scope: 'vault' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
};
userSchema.methods.createEmailVerifyToken = function createEmailVerifyToken() {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerifyToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return token;
};

userSchema.methods.createPasswordResetToken = function createPasswordResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  return token;
};

userSchema.methods.toPublicJSON = function toPublicJSON(viewerId) {
  let publicKeys = Array.isArray(this.publicKeys) ? this.publicKeys.filter(Boolean) : [];
  if (publicKeys.length === 0 && this.publicKey) {
    publicKeys = [this.publicKey];
  }

  const privacy = this.privacy || {};
  const lastSeenSetting = privacy.lastSeen || 'everyone';
  let showLastSeen = false;
  if (lastSeenSetting === 'everyone') {
    showLastSeen = true;
  } else if (lastSeenSetting === 'friends' && viewerId) {
    if (String(viewerId) === String(this._id)) {
      showLastSeen = true;
    } else {
      const friendIds = (this.friends || []).map((f) => String(f._id || f));
      showLastSeen = friendIds.includes(String(viewerId));
    }
  }

  let readReceipts = privacy.readReceipts;
  if (typeof readReceipts === 'boolean') {
    readReceipts = readReceipts ? 'everyone' : 'nobody';
  } else if (!['everyone', 'friends', 'nobody'].includes(readReceipts)) {
    readReceipts = 'everyone';
  }

  const onlineStatus =
    privacy.onlineStatus ||
    (privacy.online === 'nobody' ? 'selected' : privacy.online) ||
    'everyone';

  return {
    id: this._id,
    username: this.username,
    displayName: this.displayName || '',
    bio: this.bio || '',
    publicKeys: publicKeys.map((k) => String(k).toLowerCase()),
    keyRotatedAt: this.keyRotatedAt,
    lastLoginAt: showLastSeen ? this.lastLoginAt : null,
    hasAvatar: Boolean(this.avatarPath),
    privacy: {
      lastSeen: privacy.lastSeen || 'everyone',
      online: privacy.online || 'everyone',
      onlineStatus,
      onlineStatusVisibleTo: Array.isArray(privacy.onlineStatusVisibleTo)
        ? privacy.onlineStatusVisibleTo.map((id) => String(id._id || id))
        : [],
      readReceipts,
      typingIndicator: privacy.typingIndicator !== false,
      whoCanMessage: privacy.whoCanMessage || 'everyone',
      discoverable: privacy.discoverable || 'everyone',
      story: privacy.story || 'everyone',
      storyViewers: Array.isArray(privacy.storyViewers)
        ? privacy.storyViewers.map((id) => String(id._id || id))
        : [],
    },
    isSystemUser: Boolean(this.isSystemUser),
    systemRole: this.systemRole || null,
    verified: Boolean(this.verified),
  };
};

userSchema.methods.toSelfJSON = function toSelfJSON() {
  return {
    ...this.toPublicJSON(this._id),
    email: this.email,
    phone: this.phone || '',
    dateOfBirth: this.dateOfBirth,
    timezone: this.timezone || 'UTC',
    emailVerified: Boolean(this.emailVerified),
    lastLoginAt: this.lastLoginAt,
    blockedUsers: Array.isArray(this.blockedUsers) ? this.blockedUsers.map((id) => String(id)) : [],
    friends: Array.isArray(this.friends) ? this.friends.map((id) => String(id)) : [],   // ← add this line
    notificationSettings: normalizeNotificationSettings(this.notificationSettings),
    mutedChats: Array.isArray(this.mutedChats) ? this.mutedChats.map((m) => ({
      conversationKey: m.conversationKey,
      expiresAt: m.expiresAt,
    })) : [],
    totpEnabled: Boolean(this.totpEnabled),
  };
};

export default mongoose.model('User', userSchema, 'users');
