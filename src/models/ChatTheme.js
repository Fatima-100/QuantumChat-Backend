import mongoose from 'mongoose';

// A per-owner, per-conversation display preference. This is NOT E2E data —
// bubble color and wallpaper are cosmetic, not message content, so storing
// them (and a plaintext wallpaper image) on the server doesn't compromise
// the encryption model, the same way an avatar or group photo doesn't.
//
// `owner` is whoever set the theme; `peer` is the other participant in the
// 1:1 conversation. Like WhatsApp/Google Messages, the theme is a personal
// display setting: each side of a DM can pick their own theme (and upload
// their own wallpaper) independently, never shared with or visible to the
// other participant.
const chatThemeSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    peer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Set when the owner picks one of the top-grid combo themes; cleared
    // (undefined) as soon as they customize bubble color and/or wallpaper
    // independently, so the frontend knows whether to highlight a preset
    // tile or show "Custom".
    presetId: { type: String },
    bubbleColorId: { type: String, required: true, default: 'default' },

    // Either a named preset id (see WALLPAPERS in chatThemePresets.js) or
    // the literal 'custom', which means "look at wallpaperPath instead".
    wallpaperId: { type: String, required: true, default: 'none' },

    // Populated only when wallpaperId === 'custom'. Mirrors User.avatarPath.
    wallpaperPath: { type: String, default: null },
    wallpaperStorageProvider: { type: String, default: null },
    wallpaperMimeType: { type: String, default: null },
  },
  { timestamps: true }
);

// One theme document per (owner, peer) pair — every write upserts against
// this, so there's never more than one row to look up per DM.
chatThemeSchema.index({ owner: 1, peer: 1 }, { unique: true });

chatThemeSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    peer: this.peer,
    presetId: this.presetId || null,
    bubbleColorId: this.bubbleColorId,
    wallpaperId: this.wallpaperId,
    hasCustomWallpaper: Boolean(this.wallpaperPath),
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('ChatTheme', chatThemeSchema, 'chat_themes');
