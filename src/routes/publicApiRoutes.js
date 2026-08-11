import { Router } from 'express';
import { sendSystemMessage } from '../controllers/publicApiController.js';
import { requireApiKey, requireScope, publicApiKeyLimiter } from '../middleware/apiKeyAuth.js';

const router = Router();

// requireApiKey runs first so publicApiKeyLimiter (keyed on req.apiKey._id)
// has something to key on; publicApiIpLimiter runs even earlier, before
// either, mounted in app.js alongside the other route-level limiters.
router.use(requireApiKey);
router.use(publicApiKeyLimiter);

router.post('/messages', requireScope('messages:send'), sendSystemMessage);

export default router;
