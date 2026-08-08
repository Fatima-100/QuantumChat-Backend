import { Readable } from 'stream';
import { google } from 'googleapis';

/**
 * Durable blob storage for Vercel via a Google Drive folder.
 * Keys are Google Drive file ids. Ciphertext only — never store plaintext secrets here.
 *
 * Auth is either a service account JWT (requires a Shared Drive — Workspace only,
 * since service accounts have no storage quota on regular My Drive) or an OAuth2
 * client delegated to a personal Google account (uploads count against that
 * account's own 15GB quota; no Shared Drive needed).
 */
export class GoogleDriveStorageAdapter {
  /**
   * @param {string} folderId
   * @param {import('google-auth-library').OAuth2Client | InstanceType<typeof google.auth.JWT>} auth
   */
  constructor(folderId, auth) {
    this.folderId = folderId;
    this.drive = google.drive({ version: 'v3', auth });
    this.ready = undefined;
  }

  async ensureReady() {
    this.ready ??= this.drive.files
      .get({
        fileId: this.folderId,
        fields: 'id',
        supportsAllDrives: true,
      })
      .then(() => undefined)
      .catch((error) => {
        this.ready = undefined;
        throw error;
      });
    await this.ready;
  }

  /**
   * @param {Buffer} buffer
   * @param {string} name
   * @param {string} mimeType
   * @param {string} userId
   */
  async put(buffer, name, mimeType, userId) {
    await this.ensureReady();
    const response = await this.drive.files.create({
      requestBody: {
        name,
        parents: [this.folderId],
        appProperties: { quantumChatUserId: String(userId || '') },
      },
      media: {
        mimeType: mimeType || 'application/octet-stream',
        body: Readable.from(buffer),
      },
      fields: 'id',
      supportsAllDrives: true,
    });
    if (!response.data.id) throw new Error('Google Drive did not return a file id');
    return { key: response.data.id, provider: 'google-drive' };
  }

  async read(key) {
    await this.ensureReady();
    const response = await this.drive.files.get(
      { fileId: key, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data);
  }

  async delete(key) {
    if (!key) return;
    try {
      await this.ensureReady();
      await this.drive.files.delete({ fileId: key, supportsAllDrives: true });
    } catch {
      // best-effort (already gone / permission)
    }
  }
}
