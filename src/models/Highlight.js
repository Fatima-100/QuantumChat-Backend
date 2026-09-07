import mongoose from 'mongoose';
import { HIGHLIGHT_CATEGORY_IDS } from '../constants/highlightCategories.js';

const MAX_ITEMS = 30;

const highlightItemSchema = new mongoose.Schema(
  {
    mediaType: { type: String, enum: ['image', 'video', 'audio', 'text'], required: true },
    filename: { type: String, default: '' },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    storagePath: { type: String, required: true },
    storageProvider: {
      type: String,
      enum: ['local', 'cloudinary', 'memory', 'none'],
      default: 'cloudinary',
    },
    durationMs: { type: Number, default: 0 },
    caption: { type: String, maxlength: 200, default: '' },
    textContent: { type: String, maxlength: 700, default: '' },
    textStyle: {
      background: { type: String, maxlength: 40, default: '' },
      font: { type: String, maxlength: 40, default: '' },
      align: { type: String, enum: ['', 'left', 'center', 'right'], default: '' },
    },
    sourceStoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', default: null },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const highlightSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, enum: HIGHLIGHT_CATEGORY_IDS, required: true },
    title: { type: String, maxlength: 40, default: '' },
    coverStoragePath: { type: String, default: '' },
    coverMimeType: { type: String, default: '' },
    coverStorageProvider: {
      type: String,
      enum: ['local', 'cloudinary', 'memory', 'none', ''],
      default: '',
    },
    items: { type: [highlightItemSchema], default: [] },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

highlightSchema.index({ owner: 1, category: 1 }, { unique: true });
highlightSchema.statics.maxItems = MAX_ITEMS;

highlightSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    owner: this.owner?._id || this.owner,
    category: this.category,
    title: this.title || '',
    order: this.order || 0,
    itemCount: Array.isArray(this.items) ? this.items.length : 0,
    hasCover: Boolean(this.coverStoragePath) || (this.items || []).some((i) => i.mediaType === 'image'),
    coverItemId:
      this.coverStoragePath
        ? null
        : (this.items || []).find((i) => i.mediaType === 'image')?._id ||
          (this.items || [])[0]?._id ||
          null,
    items: (this.items || []).map((item) => ({
      id: item._id,
      mediaType: item.mediaType,
      mimetype: item.mimetype,
      size: item.size,
      durationMs: item.durationMs || 0,
      caption: item.caption || '',
      textContent: item.mediaType === 'text' ? item.textContent || '' : '',
      textStyle:
        item.mediaType === 'text'
          ? {
              background: item.textStyle?.background || '',
              font: item.textStyle?.font || '',
              align: item.textStyle?.align || 'center',
            }
          : undefined,
      sourceStoryId: item.sourceStoryId || null,
      addedAt: item.addedAt,
    })),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Highlight', highlightSchema, 'highlights');
