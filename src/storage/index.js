import { GoogleDriveStorageAdapter } from './GoogleDriveStorageAdapter.js';
import { LocalDiskStorageAdapter } from './LocalDiskStorageAdapter.js';
import { MemoryStorageAdapter } from './MemoryStorageAdapter.js';

/** @type {GoogleDriveStorageAdapter | LocalDiskStorageAdapter | MemoryStorageAdapter | null} */
let cached;

/** Accept raw folder id or a Drive share URL containing /folders/<id>. */
function normalizeDriveFolderId(raw) {
  const value = String(raw || '').trim();
  const fromUrl = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return fromUrl ? fromUrl[1] : value.replace(/\?.*$/, '');
}

function driveCredentials() {
  const folderId = normalizeDriveFolderId(process.env.GOOGLE_DRIVE_FOLDER_ID);
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const key = String(process.env.GOOGLE_PRIVATE_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
  return { folderId, email, key };
}

/**
 * Durable blob storage.
 * Prefers Google Drive when configured; falls back to local disk in non-production
 * so local avatar/story uploads work without Drive credentials.
 */
export function getStorage() {
  if (cached) return cached;

  if (process.env.STORAGE_PROVIDER === 'memory') {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Memory storage is restricted to NODE_ENV=test');
    }
    cached = new MemoryStorageAdapter();
    return cached;
  }

  if (process.env.STORAGE_PROVIDER === 'local') {
    cached = new LocalDiskStorageAdapter();
    return cached;
  }

  const { folderId, email, key } = driveCredentials();
  if (folderId && email && key) {
    cached = new GoogleDriveStorageAdapter(folderId, email, key);
    return cached;
  }

  if (process.env.NODE_ENV === 'production') {
    const missing = [
      !folderId && 'GOOGLE_DRIVE_FOLDER_ID',
      !email && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      !key && 'GOOGLE_PRIVATE_KEY',
    ].filter(Boolean);
    throw new Error(
      `Google Drive storage missing ${missing.join(', ')}. Add them to the environment and restart the server.`
    );
  }

  console.warn(
    '[storage] Google Drive credentials missing — using local uploads/ folder for development. Set GOOGLE_DRIVE_* in backend/.env for production-like storage.'
  );
  cached = new LocalDiskStorageAdapter();
  return cached;
}

export function getStorageProviderName() {
  if (process.env.STORAGE_PROVIDER === 'memory') return 'memory';
  if (process.env.STORAGE_PROVIDER === 'local') return 'local';
  const { folderId, email, key } = driveCredentials();
  if (folderId && email && key) return 'google-drive';
  return process.env.NODE_ENV === 'production' ? 'google-drive' : 'local';
}

export { GoogleDriveStorageAdapter } from './GoogleDriveStorageAdapter.js';
export { LocalDiskStorageAdapter } from './LocalDiskStorageAdapter.js';
export { MemoryStorageAdapter } from './MemoryStorageAdapter.js';
