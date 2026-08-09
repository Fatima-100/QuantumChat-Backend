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
    this.auth = auth;
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

  /**
   * Starts a resumable upload session and returns the session URL the
   * *browser* should PUT the ciphertext bytes to directly. This is what lets
   * large files bypass Vercel's ~4.5MB serverless request body cap — the
   * bytes never pass through our server.
   *
   * @param {string} name
   * @param {string} mimeType
   * @param {number} size
   * @param {string} userId
   * @param {string} [origin] Browser Origin the upload will PUT from. Drive only
   *   enables CORS on the resulting session for the origin present on *this*
   *   initiating request — omitting it leaves the session with no
   *   Access-Control-Allow-Origin, and the browser's follow-up PUT gets blocked.
   * @returns {Promise<{ mode: 'direct', uploadUrl: string }>}
   */
  async createUploadTarget(name, mimeType, size, userId, origin) {
    await this.ensureReady();
    const { token } = await this.auth.getAccessToken();
    if (!token) throw new Error('Failed to obtain Google access token');

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType || 'application/octet-stream',
          ...(size ? { 'X-Upload-Content-Length': String(size) } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify({
          name,
          parents: [this.folderId],
          appProperties: { quantumChatUserId: String(userId || '') },
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Failed to start Drive resumable upload: ${response.status} ${detail}`.trim());
    }
    const uploadUrl = response.headers.get('location');
    if (!uploadUrl) throw new Error('Google Drive did not return a resumable upload URL');
    return { mode: 'direct', uploadUrl };
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
