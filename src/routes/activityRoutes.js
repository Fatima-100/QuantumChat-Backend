import { Router } from 'express';
import { requireAuthLean } from '../middleware/auth.js';
import { apiLimiter, syncLimiter } from '../middleware/rateLimiter.js';
import { syncActivity } from '../controllers/activityController.js';

const router = Router();

// Same limiter pattern as presenceRoutes.js: apiLimiter (IP-based) runs
// before auth, syncLimiter keys on req.user._id so it must run after.
router.use(apiLimiter);
router.use(requireAuthLean);
router.use(syncLimiter);
router.get('/sync', syncActivity);

export default router;