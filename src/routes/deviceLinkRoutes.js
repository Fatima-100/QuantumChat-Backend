import { Router } from 'express';
import { verifyLinkRequest, linkStatusOrClaim } from '../controllers/deviceLinkController.js';
import { deviceLinkPublicLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(deviceLinkPublicLimiter);

router.post('/verify', verifyLinkRequest);
router.post('/status', linkStatusOrClaim);
router.post('/claim', linkStatusOrClaim);

export default router;
