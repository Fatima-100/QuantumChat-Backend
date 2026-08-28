import { Router } from 'express';
import { createReport } from '../controllers/reportController.js';
import { requireAuth } from '../middleware/auth.js';
import { reportLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post(
  "/",
  requireAuth,
  reportLimiter,
  createReport
);

export default router;
