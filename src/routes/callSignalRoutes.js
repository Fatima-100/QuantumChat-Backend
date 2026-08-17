import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter, callSignalLimiter } from '../middleware/rateLimiter.js';
import {
  createCallSignal,
  listCallSignals,
} from '../controllers/callSignalController.js';

const router = Router();

// Apply limiters via router.use() (not inline on the route) so CodeQL's
// js/missing-rate-limiting query recognizes them — same pattern as
// messageRoutes /sync and presenceRoutes.
// apiLimiter (IP) must run before requireAuth's DB lookup.
// callSignalLimiter keys on req.user._id so it must run after requireAuth.
router.use(apiLimiter);
router.use(requireAuth);
router.use(callSignalLimiter);
router.get('/', listCallSignals);
router.post('/', createCallSignal);

export default router;
