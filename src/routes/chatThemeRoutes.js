import { Router } from 'express';
import {
  listPresets,
  getChatTheme,
  setChatTheme,
  resetChatTheme,
  uploadWallpaper,
  getWallpaperImage,
  deleteWallpaperImage,
} from '../controllers/chatThemeController.js';
import { requireAuth } from '../middleware/auth.js';
import { wallpaperUpload } from '../middleware/upload.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuth);

// Static catalog first, so it isn't shadowed by the ':peerId' param route.
router.get('/presets', listPresets);

router.get('/:peerId', getChatTheme);
router.put('/:peerId', setChatTheme);
router.delete('/:peerId', resetChatTheme);

router.post('/:peerId/wallpaper', wallpaperUpload.single('wallpaper'), uploadWallpaper);
router.get('/:peerId/wallpaper', getWallpaperImage);
router.delete('/:peerId/wallpaper', deleteWallpaperImage);

export default router;
