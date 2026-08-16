import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { syncLimiter } from '../middleware/rateLimiter.js';
import { heartbeatPresence } from '../controllers/presenceController.js';

const router = Router();

router.post('/heartbeat', requireAuth, syncLimiter, heartbeatPresence);

export default router;
