import { Router } from 'express';
import {requireAuthLean} from '../middleware/auth.js';
import {
  callSignalGatewayLimiter,
  callSignalLimiter,
} from '../middleware/rateLimiter.js';
import {
  createCallSignal,
  listCallSignals,
} from '../controllers/callSignalController.js';

const router = Router();

// Limiters via router.use() so CodeQL's js/missing-rate-limiting sees them.
// callSignalGatewayLimiter (IP, high ceiling) gates requireAuth's DB lookup.
// callSignalLimiter (per-user) is the real budget — must run after requireAuth.
router.use(callSignalGatewayLimiter);
router.use(requireAuthLean);
router.use(callSignalLimiter);
router.get('/', listCallSignals);
router.post('/', createCallSignal);

export default router;
