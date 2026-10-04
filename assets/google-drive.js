/* Optional Drive transport. Loading this local file makes no Google requests.
 * UI authorisation is separate; tokens live only in this instance's memory.
 */
(function exposeDrive(root) {
  'use strict';
  const API = 'https://www.googleapis.com/drive/v3/';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/';
  const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

  function validFileId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(value)) {
      throw new Error('Invalid Google Drive file ID.');
    }
    return value;
  }

  function sharingUrl(appUrl, fileId) {
    const url = new URL(appUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported app address.');
    url.search = '';
    url.hash = new URLSearchParams({ drive: validFileId(fileId) }).toString();
    return url.href;
  }

  class DriveClient {
    #token = '';
    #expiresAt = 0;
    #generation = 0;
    #fetch;
    #now;

    constructor({ fetch: fetchRequest = root.fetch?.bind(root), now = Date.now } = {}) {
      this.#fetch = fetchRequest;
      this.#now = now;
    }

    setAccessToken(response) {
      const expiresIn = Number(response?.expires_in);
      if (!response?.access_token || typeof response.access_token !== 'string' ||
          !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error('Google did not return a valid authorisation.');
      }
      this.#generation++;
      this.#token = response.access_token;
      this.#expiresAt = this.#now() + expiresIn * 1000;
    }

    disconnect() {
      this.#generation++;
      this.#token = '';
      this.#expiresAt = 0;
    }

    get connected() {
      return Boolean(this.#token) && this.#expiresAt > this.#now() + 5000;
    }

    getPickerToken() {
      if (!this.connected) throw new Error('Reconnect Google Drive to continue.');
      return this.#token;
    }

    async #request(url, options = {}) {
      if (!this.connected) throw new Error('Reconnect Google Drive to continue.');
      const generation = this.#generation;
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${this.#token}`);
      const response = await this.#fetch(url, {
        ...options, headers, credentials: 'omit', cache: 'no-store', redirect: 'error'
      });
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (!response.ok) {
        if (response.status === 401) {
          this.disconnect();
          throw new Error('Reconnect Google Drive to continue.');
        }
        if (response.status === 403 || response.status === 404) {
          throw new Error('This Google account cannot access the file, or the file is unavailable.');
        }
        if (response.status === 429) throw new Error('Google Drive is busy. Try again later.');
        throw new Error('Google Drive could not complete the request. Your local data is unchanged.');
      }
      return response;
    }

    async #readText(response) {
      const declaredSize = Number(response.headers.get('Content-Length'));
      if (declaredSize > MAX_BACKUP_BYTES) throw new Error('The Drive file is too large to load.');
      if (!response.body) return '';
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BACKUP_BYTES) throw new Error('The Drive file is too large to load.');
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      const content = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder('utf-8', { fatal: true }).decode(content);
    }

    async readBackup(fileId) {
      validFileId(fileId);
      const generation = this.#generation;
      const fields = 'id,name,mimeType,size,modifiedTime,version,capabilities(canDownload,canEdit)';
      const metadataResponse = await this.#request(`${API}files/${fileId}?fields=${encodeURIComponent(fields)}`);
      const metadata = JSON.parse(await this.#readText(metadataResponse));
      if (metadata.mimeType !== 'application/json' && metadata.mimeType !== 'text/plain') {
        throw new Error('Choose an Emotion Wheel JSON backup file.');
      }
      if (Number(metadata.size) > MAX_BACKUP_BYTES) throw new Error('The Drive file is too large to load.');
      if (metadata.capabilities?.canDownload === false) throw new Error('The file owner has disabled downloads.');
      const contentResponse = await this.#request(`${API}files/${fileId}?alt=media`);
      const text = await this.#readText(contentResponse);
      const backup = JSON.parse(text);
      if (!backup || !Array.isArray(backup.entries)) throw new Error('The file is not an Emotion Wheel backup.');
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      // Full record/schema validation belongs to the existing app import layer.
      return { metadata, backup, text };
    }

    async createBackup(backup) {
      if (!backup || !Array.isArray(backup.entries)) throw new Error('No valid backup to save.');
      const content = JSON.stringify(backup);
      if (new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) {
        throw new Error('The backup is too large to save to Drive. Use a file backup.');
      }
      const boundary = `emotion_wheel_${root.crypto.randomUUID()}`;
      const metadata = { name: 'Emotion Wheel backup.json', mimeType: 'application/json',
        appProperties: { application: 'emotion-wheel' } };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${content}\r\n--${boundary}--\r\n`;
      const response = await this.#request(`${UPLOAD}files?uploadType=multipart&fields=id,name,version,webViewLink`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
      });
      const result = JSON.parse(await this.#readText(response));
      validFileId(result.id);
      return result;
    }
  }

  const exports = Object.freeze({ DriveClient, validFileId, sharingUrl, MAX_BACKUP_BYTES });
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.EmotionWheelDrive = exports;
})(typeof globalThis === 'undefined' ? window : globalThis);
