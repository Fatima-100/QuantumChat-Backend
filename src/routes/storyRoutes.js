import { Router } from 'express';
import { createStory, deleteStory, getStoryById, getStoryMedia, getStoryViewers, listStories, markStoryViewed } from '../controllers/storyController.js';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { storyUpload } from '../middleware/upload.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuth);
router.get('/', listStories);
router.post('/', storyUpload.single('file'), createStory);
router.get('/:id', getStoryById);
router.get('/:id/media', getStoryMedia);
router.post('/:id/view', markStoryViewed);     
router.get('/:id/viewers', getStoryViewers);   
router.delete('/:id', deleteStory);

export default router;