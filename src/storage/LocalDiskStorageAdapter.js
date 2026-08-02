import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../../uploads');

/**
 * Local disk storage for development when Google Drive credentials are not set.
 * Keys are relative paths under the uploads root (e.g. avatars/<uuid>.jpg).
 */
export class LocalDiskStorageAdapter {
  /**
   * @param {string} [rootDir]
   */
  constructor(rootDir = DEFAULT_ROOT) {
    this.rootDir = rootDir;
  }

  resolveKey(key) {
    const relative = String(key || '').replace(/^[/\\]+/, '');
    const absolute = path.resolve(this.rootDir, relative);
    const root = path.resolve(this.rootDir);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return absolute;
  }

  async ensureReady() {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  /**
   * @param {Buffer} buffer
   * @param {string} name
   * @param {string} _mimeType
   * @param {string} _userId
   */
  async put(buffer, name, _mimeType, _userId) {
    await this.ensureReady();
    const relative = String(name || `blob/${crypto.randomUUID()}`).replace(/^[/\\]+/, '');
    const absolute = this.resolveKey(relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);
    return { key: relative.replace(/\\/g, '/'), provider: 'local' };
  }

  async read(key) {
    try {
      return await fs.readFile(this.resolveKey(key));
    } catch (err) {
      if (err?.code === 'ENOENT') {
        const error = new Error('Stored object not found');
        error.code = 'ENOENT';
        throw error;
      }
      throw err;
    }
  }

  async delete(key) {
    if (!key) return;
    try {
      await fs.unlink(this.resolveKey(key));
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
}
