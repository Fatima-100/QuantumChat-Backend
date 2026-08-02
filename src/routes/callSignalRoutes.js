import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { callSignalLimiter } from '../middleware/rateLimiter.js';
import {
  createCallSignal,
  listCallSignals,
} from '../controllers/callSignalController.js';

const router = Router();

// callSignalLimiter keys on req.user._id, so requireAuth has to run first —
// same ordering as the /messages/sync polling route. Keying by IP instead
// would make two callers behind one NAT share a budget and 429 each other's
// ICE candidates mid-handshake.
router.get('/', requireAuth, callSignalLimiter, listCallSignals);
router.post('/', requireAuth, callSignalLimiter, createCallSignal);

export default router;
