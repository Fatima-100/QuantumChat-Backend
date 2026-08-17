import mongoose from 'mongoose';

const appConfigSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    publicKey: String,
    privateKey: String,
    subject: String,
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'app_config' }
);

export default mongoose.model('AppConfig', appConfigSchema);
