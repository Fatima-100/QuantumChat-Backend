import { google } from 'googleapis';
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

/**
 * OAuth2 delegated to a personal Google account. Uploads land in that
 * account's own My Drive and count against its normal 15GB quota — no
 * Shared Drive (Workspace) required.
 */
function driveOAuthCredentials() {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
  return { clientId, clientSecret, refreshToken };
}

/**
 * Service account JWT. Only works when GOOGLE_DRIVE_FOLDER_ID points into a
 * Shared Drive — service accounts have no quota on regular My Drive folders.
 */
function driveServiceAccountCredentials() {
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const key = String(process.env.GOOGLE_PRIVATE_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
  return { email, key };
}

function buildDriveAuth() {
  const { clientId, clientSecret, refreshToken } = driveOAuthCredentials();
  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return auth;
  }

  const { email, key } = driveServiceAccountCredentials();
  if (email && key) {
    return new google.auth.JWT({
      email,
      key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  }

  return null;
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

  const folderId = normalizeDriveFolderId(process.env.GOOGLE_DRIVE_FOLDER_ID);
  const auth = buildDriveAuth();
  if (folderId && auth) {
    cached = new GoogleDriveStorageAdapter(folderId, auth);
    return cached;
  }

  if (process.env.NODE_ENV === 'production') {
    const missing = [
      !folderId && 'GOOGLE_DRIVE_FOLDER_ID',
      !auth &&
        'GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/GOOGLE_OAUTH_REFRESH_TOKEN (or GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY)',
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
  const folderId = normalizeDriveFolderId(process.env.GOOGLE_DRIVE_FOLDER_ID);
  if (folderId && buildDriveAuth()) return 'google-drive';
  return process.env.NODE_ENV === 'production' ? 'google-drive' : 'local';
}

export { GoogleDriveStorageAdapter } from './GoogleDriveStorageAdapter.js';
export { LocalDiskStorageAdapter } from './LocalDiskStorageAdapter.js';
export { MemoryStorageAdapter } from './MemoryStorageAdapter.js';
