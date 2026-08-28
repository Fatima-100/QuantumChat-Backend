import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { reportLimiter } from '../middleware/rateLimiter.js';
import { createReport } from '../controllers/reportController.js';

const router = Router();

router.use(requireAuth);
router.use(reportLimiter);
router.post('/', createReport);

export default router;
