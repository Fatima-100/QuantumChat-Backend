import { Router } from 'express';
import {
  addHighlightItem,
  deleteHighlight,
  deleteHighlightItem,
  getHighlight,
  getHighlightCover,
  getHighlightItemMedia,
  listHighlightCategories,
  listHighlights,
} from '../controllers/highlightController.js';
import { requireAuthLean } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { highlightUpload } from '../middleware/upload.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuthLean);

router.get('/categories', listHighlightCategories);
router.get('/', listHighlights);
router.post('/items', highlightUpload.single('file'), addHighlightItem);
router.get('/:id', getHighlight);
router.delete('/:id', deleteHighlight);
router.get('/:id/cover', getHighlightCover);
router.delete('/:id/items/:itemId', deleteHighlightItem);
router.get('/:id/items/:itemId/media', getHighlightItemMedia);

export default router;
