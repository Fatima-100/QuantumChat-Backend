import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter, syncLimiter } from '../middleware/rateLimiter.js';
import { heartbeatPresence } from '../controllers/presenceController.js';

const router = Router();

// Apply limiters via router.use() (not inline on the route) so CodeQL's
// js/missing-rate-limiting query recognizes them — same pattern as
// messageRoutes /sync and storyRoutes. apiLimiter (IP) runs before auth;
// syncLimiter keys on req.user._id so it must run after requireAuth.
router.use(apiLimiter);
router.use(requireAuth);
router.use(syncLimiter);
router.post('/heartbeat', heartbeatPresence);

export default router;
