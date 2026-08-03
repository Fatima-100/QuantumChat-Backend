import ChatTheme from '../models/ChatTheme.js';
import User from '../models/User.js';
import { toObjectId } from '../utils/toObjectId.js';
import { getStorage, newObjectName, safeImageContentType } from '../middleware/upload.js';
import {
  getCatalog,
  getPresetById,
  isValidBubbleColorId,
  isValidPresetId,
  isValidWallpaperId,
  CUSTOM_WALLPAPER_ID,
} from '../utils/chatThemePresets.js';

function requirePeerId(req, res) {
  const peerId = toObjectId(req.params.peerId);
  if (!peerId) {
    res.status(400).json({ success: false, error: 'Invalid peer id' });
    return null;
  }
  if (String(peerId) === String(req.user._id)) {
    res.status(400).json({ success: false, error: 'Cannot set a chat theme with yourself' });
    return null;
  }
  return peerId;
}

async function requirePeerExists(peerId, res) {
  const exists = await User.exists({ _id: peerId });
  if (!exists) {
    res.status(404).json({ success: false, error: 'User not found' });
    return false;
  }
  return true;
}

const DEFAULT_THEME_JSON = (peerId) => ({
  peer: peerId,
  presetId: null,
  bubbleColorId: 'default',
  wallpaperId: 'none',
  hasCustomWallpaper: false,
  updatedAt: null,
});

// GET /api/chat-themes/presets
// Static catalog the frontend renders the picker from — fetched once
// rather than hard-coded twice (backend validation + frontend UI).
export async function listPresets(req, res) {
  res.json({ success: true, data: getCatalog() });
}

// GET /api/chat-themes/:peerId
// Returns the caller's saved theme for that conversation, or the default
// if they've never set one.
export async function getChatTheme(req, res) {
  const peerId = requirePeerId(req, res);
  if (!peerId) return;

  const theme = await ChatTheme.findOne({ owner: req.user._id, peer: peerId });
  if (!theme) {
    return res.json({ success: true, data: DEFAULT_THEME_JSON(peerId) });
  }
  res.json({ success: true, data: theme.toPublicJSON() });
}

// PUT /api/chat-themes/:peerId
// Body is EITHER:
//   { presetId }                    -> apply a top-grid combo theme
//   { bubbleColorId, wallpaperId }  -> independent "Customize" picks
// wallpaperId here must be a named preset — clients switch to a custom
// wallpaper only via POST .../wallpaper (see below), which sets it for them.
export async function setChatTheme(req, res) {
  const peerId = requirePeerId(req, res);
  if (!peerId) return;
  if (!(await requirePeerExists(peerId, res))) return;

  const { presetId, bubbleColorId, wallpaperId } = req.body;

  const mongoUpdate = { $set: {}, $unset: {} };
  if (presetId !== undefined) {
    if (!isValidPresetId(presetId)) {
      return res.status(400).json({ success: false, error: 'Unknown presetId' });
    }
    const preset = getPresetById(presetId);
    mongoUpdate.$set = { presetId: preset.id, bubbleColorId: preset.bubbleColorId, wallpaperId: preset.wallpaperId };
    // Picking a named preset always drops any previously uploaded custom
    // wallpaper file (delete-then-clear, mirroring uploadAvatar's swap).
    mongoUpdate.$unset = { wallpaperPath: 1, wallpaperStorageProvider: 1, wallpaperMimeType: 1 };
  } else {
    // Bubble color and wallpaper can now be updated independently — only
    // validate/apply whichever field was actually sent. This is what makes
    // "change bubble color while a custom wallpaper is active" work: the
    // client omits wallpaperId entirely rather than re-sending 'custom'
    // (which this endpoint intentionally rejects — custom wallpapers are
    // only set via POST /:peerId/wallpaper).
    if (bubbleColorId === undefined && wallpaperId === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Provide at least one of bubbleColorId or wallpaperId (or a presetId).',
      });
    }
    if (bubbleColorId !== undefined && !isValidBubbleColorId(bubbleColorId)) {
      return res.status(400).json({ success: false, error: 'Invalid bubbleColorId' });
    }
    if (wallpaperId !== undefined && !isValidWallpaperId(wallpaperId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallpaperId (use POST /:peerId/wallpaper to set a custom image)',
      });
    }

    mongoUpdate.$set = {};
    mongoUpdate.$unset = { presetId: 1 };
    if (bubbleColorId !== undefined) mongoUpdate.$set.bubbleColorId = bubbleColorId;
    if (wallpaperId !== undefined) {
      mongoUpdate.$set.wallpaperId = wallpaperId;
      // Switching to a named wallpaper drops any previously uploaded
      // custom image's file reference. If wallpaperId wasn't part of this
      // request at all (e.g. just changing bubble color), the existing
      // custom wallpaper — and its file — are left completely untouched.
      mongoUpdate.$unset.wallpaperPath = 1;
      mongoUpdate.$unset.wallpaperStorageProvider = 1;
      mongoUpdate.$unset.wallpaperMimeType = 1;
    }
  }

  const previous = await ChatTheme.findOne({ owner: req.user._id, peer: peerId });
  const theme = await ChatTheme.findOneAndUpdate({ owner: req.user._id, peer: peerId }, mongoUpdate, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });

  if (previous?.wallpaperPath && mongoUpdate.$unset?.wallpaperPath) {
    try {
      await getStorage().delete(previous.wallpaperPath);
    } catch {
      // best-effort — an orphaned Drive object isn't worth failing the request over
    }
  }

  res.json({ success: true, data: theme.toPublicJSON() });
}

// POST /api/chat-themes/:peerId/wallpaper  (multipart, field name 'wallpaper')
// Uploads a custom wallpaper image for this conversation, replacing any
// previous custom wallpaper. Sets wallpaperId to the 'custom' sentinel and
// clears presetId, same as picking any other wallpaper would.
export async function uploadWallpaper(req, res) {
  const peerId = requirePeerId(req, res);
  if (!peerId) return;
  if (!(await requirePeerExists(peerId, res))) return;

  if (!req.file?.buffer) {
    return res.status(400).json({ success: false, error: 'Image file is required' });
  }

  try {
    const storage = getStorage();
    const ext = (() => {
      const raw = String(req.file.originalname || '');
      const i = raw.lastIndexOf('.');
      return i >= 0 ? raw.slice(i).toLowerCase() : '.jpg';
    })();
    const objectName = newObjectName('wallpapers', ext === '.jpeg' ? '.jpg' : ext);
    const stored = await storage.put(
      req.file.buffer,
      objectName,
      safeImageContentType(req.file.mimetype),
      String(req.user._id)
    );

    const previous = await ChatTheme.findOne({ owner: req.user._id, peer: peerId });

    const theme = await ChatTheme.findOneAndUpdate(
      { owner: req.user._id, peer: peerId },
      {
        $set: {
          wallpaperId: CUSTOM_WALLPAPER_ID,
          wallpaperPath: stored.key,
          wallpaperStorageProvider: stored.provider,
          wallpaperMimeType: safeImageContentType(req.file.mimetype),
        },
        $unset: { presetId: 1 },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (previous?.wallpaperPath && previous.wallpaperPath !== stored.key) {
      try {
        await storage.delete(previous.wallpaperPath);
      } catch {
        // best-effort
      }
    }

    res.json({ success: true, data: theme.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/chat-themes/:peerId/wallpaper
// Streams the caller's own uploaded wallpaper image. Owner-only — this is a
// personal display asset, not something shared with the peer, so there is
// no "is this my conversation too" branch the way group photos have.
export async function getWallpaperImage(req, res) {
  const peerId = requirePeerId(req, res);
  if (!peerId) return;

  try {
    const theme = await ChatTheme.findOne({ owner: req.user._id, peer: peerId }).select(
      'wallpaperPath wallpaperMimeType'
    );
    if (!theme?.wallpaperPath) {
      return res.status(404).json({ success: false, error: 'No custom wallpaper set' });
    }
    const bytes = await getStorage().read(theme.wallpaperPath);
    res.setHeader('Content-Type', safeImageContentType(theme.wallpaperMimeType));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(bytes);
  } catch {
    if (!res.headersSent) {
      res.status(404).json({ success: false, error: 'Wallpaper image not found' });
    }
  }
}

// DELETE /api/chat-themes/:peerId/wallpaper
// Clears only the custom wallpaper, falling back to the 'none' wallpaper
// while leaving the chosen bubble color untouched. Distinct from the full
// DELETE /:peerId reset below.
export async function deleteWallpaperImage(req, res) {
  const peerId = requirePeerId(req, res);
  if (!peerId) return;

  const theme = await ChatTheme.findOne({ owner: req.user._id, peer: peerId });
  if (theme?.wallpaperPath) {
    try {
      await getStorage().delete(theme.wallpaperPath);
    } catch {
      // best-effort
    }
    theme.wallpaperId = 'none';
    theme.wallpaperPath = null;
    theme.wallpaperStorageProvider = null;
    theme.wallpaperMimeType = null;
    await theme.save();
    return res.json({ success: true, data: theme.toPublicJSON() });
  }

  res.json({ success: true, data: theme ? theme.toPublicJSON() : DEFAULT_THEME_JSON(peerId) });
}

// DELETE /api/chat-themes/:peerId
// Reverts the whole conversation theme (bubble + wallpaper) back to
// default for the caller only, deleting any uploaded wallpaper file too.
export async function resetChatTheme(req, res) {
  const peerId = requirePeerId(req, res);
  if (!peerId) return;

  const theme = await ChatTheme.findOne({ owner: req.user._id, peer: peerId });
  if (theme?.wallpaperPath) {
    try {
      await getStorage().delete(theme.wallpaperPath);
    } catch {
      // best-effort
    }
  }
  await ChatTheme.deleteOne({ owner: req.user._id, peer: peerId });
  res.json({ success: true, data: DEFAULT_THEME_JSON(peerId) });
}
