import { Router } from 'express';
import {
  initAttachmentUpload,
  uploadPendingAttachmentBytes,
  finalizeAttachmentUpload,
  downloadAttachment,
} from '../controllers/attachmentController.js';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuth);

// Three-step upload: init (validate + get an upload target) -> put bytes
// (proxied through us to Cloudinary, or local/dev storage) -> finalize
// (create the Attachment record).
router.post('/init', initAttachmentUpload);
router.put('/pending/:id/bytes', upload.single('file'), uploadPendingAttachmentBytes);
router.post('/finalize', finalizeAttachmentUpload);

router.get('/:id/raw', downloadAttachment);

export default router;
