import { Router } from 'express';
import { searchGifs } from '../controllers/gifController.js';
import { requireAuthLean } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuthLean);
router.get('/search', searchGifs);

export default router;