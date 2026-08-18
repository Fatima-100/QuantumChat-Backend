import mongoose from 'mongoose';

const LINK_STATUSES = ['pending', 'verified', 'approved', 'rejected', 'used', 'expired'];

const deviceLinkRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    linkId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: LINK_STATUSES,
      default: 'pending',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    requestingDeviceInfo: {
      label: { type: String, trim: true, maxlength: 200, default: '' },
      userAgent: { type: String, trim: true, maxlength: 512, default: '' },
      ip: { type: String, trim: true, maxlength: 64, default: '' },
    },
    linkedSessionId: {
      type: String,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

deviceLinkRequestSchema.index({ user: 1, status: 1, expiresAt: 1 });

export { LINK_STATUSES };
export default mongoose.model('DeviceLinkRequest', deviceLinkRequestSchema);
