import mongoose from 'mongoose';
import path from 'path';
import {
  getHighlightCategory,
  HIGHLIGHT_CATEGORIES,
  HIGHLIGHT_CATEGORY_IDS,
} from '../constants/highlightCategories.js';
import { getStorage, isSafeImageMime, newObjectName, safeImageContentType } from '../middleware/upload.js';
import Highlight from '../models/Highlight.js';
import User from '../models/User.js';
import { areUsersBlocked } from './userController.js';

function mediaTypeFromMime(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return null;
}

async function canViewProfile(viewer, ownerId) {
  if (String(viewer._id) === String(ownerId)) return true;
  if (await areUsersBlocked(viewer._id, ownerId)) return false;
  const owner = await User.findById(ownerId).select('privacy blockedUsers friends');
  if (!owner) return false;
  const visibility = owner.privacy?.profileVisibility || 'everyone';
  if (visibility === 'nobody') return false;
  if (visibility === 'friends') {
    const friends = (owner.friends || []).map(String);
    return friends.includes(String(viewer._id));
  }
  return true;
}

function categoryOrder(id) {
  const idx = HIGHLIGHT_CATEGORY_IDS.indexOf(id);
  return idx >= 0 ? idx : 99;
}

export async function listHighlightCategories(_req, res) {
  res.json({ success: true, data: HIGHLIGHT_CATEGORIES });
}

export async function listHighlights(req, res) {
  try {
    const userId = req.query.userId || req.user._id;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }
    if (!(await canViewProfile(req.user, userId))) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }

    const highlights = await Highlight.find({ owner: userId }).sort({ order: 1, createdAt: 1 });
    const isOwner = String(req.user._id) === String(userId);

    // Non-owners only see highlights that have at least one item.
    const list = highlights
      .filter((h) => isOwner || (h.items && h.items.length > 0))
      .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category))
      .map((h) => {
        const pub = h.toPublicJSON();
        const cat = getHighlightCategory(h.category);
        return {
          ...pub,
          emoji: cat?.emoji || '',
          label: h.title || cat?.label || h.category,
        };
      });

    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getHighlight(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid highlight id' });
    }
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (!(await canViewProfile(req.user, highlight.owner))) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    const isOwner = String(req.user._id) === String(highlight.owner);
    if (!isOwner && !(highlight.items || []).length) {
      return res.status(404).json({ success: false, error: 'Highlight not found' });
    }
    const cat = getHighlightCategory(highlight.category);
    res.json({
      success: true,
      data: {
        ...highlight.toPublicJSON(),
        emoji: cat?.emoji || '',
        label: highlight.title || cat?.label || highlight.category,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Add media to a category highlight (creates the highlight if needed). */
export async function addHighlightItem(req, res) {
  try {
    const category = String(req.body.category || '').toLowerCase();
    if (!HIGHLIGHT_CATEGORY_IDS.includes(category)) {
      return res.status(400).json({ success: false, error: 'Invalid highlight category' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'Media file is required' });
    }

    const mimetype = req.file.mimetype || 'application/octet-stream';
    const mediaType =
      mediaTypeFromMime(mimetype) ||
      (['image', 'video', 'audio', 'text'].includes(String(req.body.mediaType || ''))
        ? String(req.body.mediaType)
        : null);
    if (!mediaType) {
      return res.status(400).json({ success: false, error: 'Unsupported media type' });
    }

    let highlight = await Highlight.findOne({ owner: req.user._id, category });
    if (!highlight) {
      const cat = getHighlightCategory(category);
      highlight = await Highlight.create({
        owner: req.user._id,
        category,
        title: cat?.label || category,
        order: categoryOrder(category),
        items: [],
      });
    }

    if ((highlight.items || []).length >= Highlight.maxItems) {
      return res.status(400).json({
        success: false,
        error: `This highlight already has ${Highlight.maxItems} items`,
      });
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const safeExt = ext === '.svg' ? '' : ext;
    const objectName = newObjectName('highlights', safeExt);
    const stored = await getStorage().put(
      req.file.buffer,
      objectName,
      mimetype,
      String(req.user._id)
    );

    let durationMs = Number(req.body.durationMs || 0);
    if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;

    const caption =
      typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, 200) : '';

    const sourceStoryId =
      req.body.sourceStoryId && mongoose.isValidObjectId(req.body.sourceStoryId)
        ? req.body.sourceStoryId
        : null;

    const item = {
      mediaType,
      filename: req.file.originalname || objectName,
      mimetype,
      size: req.file.size,
      storagePath: stored.key,
      storageProvider: stored.provider,
      durationMs,
      caption,
      sourceStoryId,
      addedAt: new Date(),
    };

    highlight.items.push(item);

    // Prefer first image as cover.
    if (!highlight.coverStoragePath && mediaType === 'image') {
      highlight.coverStoragePath = stored.key;
      highlight.coverMimeType = mimetype;
      highlight.coverStorageProvider = stored.provider;
    } else if (!highlight.coverStoragePath && highlight.items.length === 1) {
      highlight.coverStoragePath = stored.key;
      highlight.coverMimeType = mimetype;
      highlight.coverStorageProvider = stored.provider;
    }

    await highlight.save();

    const cat = getHighlightCategory(category);
    res.status(201).json({
      success: true,
      data: {
        ...highlight.toPublicJSON(),
        emoji: cat?.emoji || '',
        label: highlight.title || cat?.label || category,
      },
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, error: 'Highlight already exists' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deleteHighlight(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid highlight id' });
    }
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (String(highlight.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const storage = getStorage();
    const paths = new Set();
    if (highlight.coverStoragePath) paths.add(highlight.coverStoragePath);
    for (const item of highlight.items || []) {
      if (item.storagePath) paths.add(item.storagePath);
    }
    for (const p of paths) {
      try {
        await storage.delete(p);
      } catch {
        // best-effort
      }
    }
    await Highlight.deleteOne({ _id: highlight._id });
    res.json({ success: true, data: { id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deleteHighlightItem(req, res) {
  try {
    const { id, itemId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (String(highlight.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const item = (highlight.items || []).id(itemId);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    const storage = getStorage();
    try {
      if (item.storagePath) await storage.delete(item.storagePath);
    } catch {
      // ignore
    }

    const wasCover = highlight.coverStoragePath && highlight.coverStoragePath === item.storagePath;
    item.deleteOne();

    if (wasCover) {
      const nextCover = (highlight.items || []).find((i) => i.mediaType === 'image') || highlight.items?.[0];
      if (nextCover) {
        highlight.coverStoragePath = nextCover.storagePath;
        highlight.coverMimeType = nextCover.mimetype;
        highlight.coverStorageProvider = nextCover.storageProvider;
      } else {
        highlight.coverStoragePath = '';
        highlight.coverMimeType = '';
        highlight.coverStorageProvider = '';
      }
    }

    await highlight.save();
    const cat = getHighlightCategory(highlight.category);
    res.json({
      success: true,
      data: {
        ...highlight.toPublicJSON(),
        emoji: cat?.emoji || '',
        label: highlight.title || cat?.label || highlight.category,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getHighlightCover(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid highlight id' });
    }
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (!(await canViewProfile(req.user, highlight.owner))) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }

    let storagePath = highlight.coverStoragePath;
    let mimetype = highlight.coverMimeType || 'image/jpeg';
    if (!storagePath) {
      const first =
        (highlight.items || []).find((i) => i.mediaType === 'image') || (highlight.items || [])[0];
      if (!first?.storagePath) {
        return res.status(404).json({ success: false, error: 'No cover' });
      }
      storagePath = first.storagePath;
      mimetype = first.mimetype;
    }

    const bytes = await getStorage().read(storagePath);
    if (isSafeImageMime(mimetype)) {
      res.setHeader('Content-Type', safeImageContentType(mimetype));
    } else {
      res.setHeader('Content-Type', mimetype || 'application/octet-stream');
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  } catch (err) {
    if (!res.headersSent) {
      res.status(404).json({ success: false, error: 'Cover missing' });
    }
  }
}

export async function getHighlightItemMedia(req, res) {
  try {
    const { id, itemId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (!(await canViewProfile(req.user, highlight.owner))) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    const item = (highlight.items || []).id(itemId);
    if (!item?.storagePath) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const bytes = await getStorage().read(item.storagePath);
    if (isSafeImageMime(item.mimetype)) {
      res.setHeader('Content-Type', safeImageContentType(item.mimetype));
      res.setHeader('Content-Disposition', 'inline');
    } else if (
      String(item.mimetype || '').startsWith('video/') ||
      String(item.mimetype || '').startsWith('audio/')
    ) {
      res.setHeader('Content-Type', item.mimetype);
      res.setHeader('Content-Disposition', 'inline');
    } else {
      res.setHeader('Content-Type', item.mimetype || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  } catch (err) {
    if (!res.headersSent) {
      res.status(404).json({ success: false, error: 'Media missing' });
    }
  }
}
