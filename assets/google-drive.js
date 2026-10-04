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

    async #request(url, options = {}, operation = '') {
      if (!this.connected) throw new Error('Reconnect Google Drive to continue.');
      const generation = this.#generation;
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${this.#token}`);
      let response;
      const attempts = !options.method || options.method === 'GET' ? 3 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          response = await this.#fetch(url, {
            ...options, headers, credentials: 'omit', cache: 'no-store', redirect: options.redirect || 'error'
          });
          break;
        } catch {
          if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
          if (attempt + 1 < attempts) {
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 250));
            if (generation !== this.#generation || !this.connected) throw new Error('Google Drive connection changed.');
            continue;
          }
          const action = operation || (options.method === 'POST' ? 'saving the backup' :
            url.includes('?alt=media') ? 'downloading the backup' : 'checking file access');
          const error = new Error(`Google Drive connection failed while ${action}. Try again. Your local data is unchanged.`);
          error.code = 'drive-network';
          throw error;
        }
      }
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (!response.ok) {
        if (response.status === 401) {
          this.disconnect();
          throw new Error('Reconnect Google Drive to continue.');
        }
        if (response.status === 403 || response.status === 404) {
          const error = new Error('This Google account cannot access the file, or the file is unavailable.');
          error.code = 'drive-access';
          throw error;
        }
        if (response.status === 412) { const error = new Error('The Drive file changed elsewhere. Sync paused; your local data is kept.'); error.code = 'drive-conflict'; throw error; }
        if (response.status === 429) throw new Error('Google Drive is busy. Try again later.');
        throw new Error(`Google Drive could not complete the request (HTTP ${response.status}). Your local data is unchanged.`);
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
      const fields = 'id,name,mimeType,size,modifiedTime,version,owners(displayName,emailAddress),capabilities(canDownload,canEdit,canShare)';
      const metadataResponse = await this.#request(`${API}files/${fileId}?fields=${encodeURIComponent(fields)}`);
      const metadata = JSON.parse(await this.#readText(metadataResponse));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (metadata.mimeType !== 'application/json' && metadata.mimeType !== 'text/plain') {
        throw new Error('Choose an Emotion Wheel JSON backup file.');
      }
      if (Number(metadata.size) > MAX_BACKUP_BYTES) throw new Error('The Drive file is too large to load.');
      if (metadata.capabilities?.canDownload === false) throw new Error('The file owner has disabled downloads.');
      // Google's download example follows redirects. Fetch removes the bearer
      // header on cross-origin redirects; cookies remain omitted throughout.
      // Metadata and uploads retain redirect:error.
      const contentResponse = await this.#request(`${API}files/${fileId}?alt=media`, { redirect: 'follow' });
      const text = await this.#readText(contentResponse);
      const backup = JSON.parse(text);
      if (!backup || !Array.isArray(backup.entries)) throw new Error('The file is not an Emotion Wheel backup.');
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      // Full record/schema validation belongs to the existing app import layer.
      return { metadata, backup, text };
    }

    async getConnectedEmail() {
      const generation = this.#generation;
      const response = await this.#request('https://openidconnect.googleapis.com/v1/userinfo', {}, 'checking the connected account');
      const account = JSON.parse(await this.#readText(response));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (account.email_verified !== true || typeof account.email !== 'string' || !account.email.includes('@')) {
        throw new Error('Google did not provide a verified account email.');
      }
      return account.email;
    }

    async shareWithViewer(fileId, email, notify = false) {
      validFileId(fileId);
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Enter a valid recipient email address.');
      }
      const generation = this.#generation;
      const response = await this.#request(`${API}files/${fileId}/permissions?sendNotificationEmail=${notify === true}&fields=id,type,role,emailAddress`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: email })
      }, 'granting Viewer access');
      const permission = JSON.parse(await this.#readText(response));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (permission.role !== 'reader' || permission.type !== 'user') throw new Error('Google did not confirm Viewer access. Check sharing in Drive before sharing the link.');
      return permission;
    }

    // v2 exposes the file ETag in JSON, avoiding reliance on CORS-exposed headers.
    // Live stale-ETag rejection must pass before automatic updates are released.
    async getUpdateState(fileId) {
      validFileId(fileId);
      const generation = this.#generation;
      const fields = 'id,etag,editable,owners(emailAddress),headRevisionId';
      const response = await this.#request(`https://www.googleapis.com/drive/v2/files/${fileId}?fields=${encodeURIComponent(fields)}`, { redirect: 'follow' }, 'checking the sync baseline');
      const state = JSON.parse(await this.#readText(response));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (state.id !== fileId || typeof state.etag !== 'string' || !/^"[^"\r\n]+"$/.test(state.etag)) {
        throw new Error('Drive did not provide a safe update baseline. Sync is unavailable.');
      }
      return state;
    }

    async updateBackup(fileId, backup, expectedEtag) {
      validFileId(fileId);
      if (typeof expectedEtag !== 'string' || !/^"[^"\r\n]+"$/.test(expectedEtag)) throw new Error('A safe Drive update baseline is required.');
      if (!backup || !Array.isArray(backup.entries)) throw new Error('No valid backup to sync.');
      const content = JSON.stringify(backup);
      if (new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) throw new Error('The backup is too large to sync.');
      const generation = this.#generation;
      const response = await this.#request(`https://www.googleapis.com/upload/drive/v2/files/${fileId}?uploadType=media&newRevision=true&pinned=true&fields=id,etag,headRevisionId`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'If-Match': expectedEtag }, body: content
      }, 'syncing the backup');
      const result = JSON.parse(await this.#readText(response));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (result.id !== fileId || typeof result.etag !== 'string' || !/^"[^"\r\n]+"$/.test(result.etag)) {
        throw new Error('Drive update result is uncertain. Sync paused; check the file before retrying.');
      }
      return result;
    }

    async createBackup(backup) {
      const generation = this.#generation;
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
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      validFileId(result.id);
      return result;
    }
  }

  const exports = Object.freeze({ DriveClient, validFileId, sharingUrl, MAX_BACKUP_BYTES });
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.EmotionWheelDrive = exports;
})(typeof globalThis === 'undefined' ? window : globalThis);
