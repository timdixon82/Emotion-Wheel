/* Optional Drive transport. Loading this local file makes no Google requests.
 * UI authorisation is separate; tokens live only in this instance's memory.
 */
(function exposeDrive(root) {
  'use strict';
  const API = 'https://www.googleapis.com/drive/v3/';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/';
  const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

  function sharedListContent(list) {
    const schema = root.EmotionWheelSharedList || (typeof module !== 'undefined' && module.exports ? require('./shared-dataset-list.js') : null);
    if (!schema) throw new Error('Shared-file list support is unavailable.');
    const value = schema.validate(list);
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BACKUP_BYTES) throw new Error('Shared-file list is too large.');
    return value;
  }

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

    get tokenExpiresAt() {
      return this.#expiresAt;
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
      const fields = 'id,name,mimeType,size,modifiedTime,version,parents,appProperties,trashed,owners(displayName,emailAddress),capabilities(canDownload,canEdit,canShare)';
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

    async #requireSharingOwner(fileId, ownerEmail) {
      const generation = this.#generation;
      validFileId(fileId);
      if (!ownerEmail) throw new Error('Reconnect Google to check the file owner.');
      const response = await this.#request(`${API}files/${fileId}?fields=id,name,trashed,owners(emailAddress)`);
      const file = JSON.parse(await this.#readText(response));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (file.trashed || !file.owners?.some(owner => owner.emailAddress === ownerEmail)) throw new Error('You can manage sharing only for a file you own.');
      return file;
    }

    async getSharing(fileId, ownerEmail) {
      const generation = this.#generation;
      const file = await this.#requireSharingOwner(fileId, ownerEmail);
      const permissions = [], seen = new Set();
      let pageToken;
      do {
        const params = new URLSearchParams({fields:'nextPageToken,permissions(id,type,role,emailAddress,displayName,domain,deleted)',pageSize:'100'});
        if (pageToken) params.set('pageToken', pageToken);
        const response = await this.#request(`${API}files/${fileId}/permissions?${params}`);
        const page = JSON.parse(await this.#readText(response));
        if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
        if (!Array.isArray(page.permissions)) throw new Error('Google did not return the sharing list.');
        permissions.push(...page.permissions.filter(permission => !permission.deleted));
        pageToken = page.nextPageToken;
        if (pageToken && (seen.has(pageToken) || permissions.length > 10000)) throw new Error('The sharing list could not be completed. Check access in Google Drive.');
        seen.add(pageToken);
      } while (pageToken);
      return {file, permissions};
    }

    async stopSharing(fileId, permissionId, ownerEmail) {
      if (typeof permissionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(permissionId)) throw new Error('Invalid Google permission. Refresh the sharing list.');
      const generation = this.#generation;
      const sharing = await this.getSharing(fileId, ownerEmail);
      const permission = sharing.permissions.find(item => item.id === permissionId);
      if (!permission || permission.role === 'owner' || !['user','group','domain','anyone'].includes(permission.type)) throw new Error('This access cannot be removed here. Refresh the sharing list.');
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      await this.#request(`${API}files/${fileId}/permissions/${encodeURIComponent(permissionId)}`, {method:'DELETE'}, 'removing sharing access');
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

    async listManagedFiles(query) {
      const generation = this.#generation;
      const files = [];
      let pageToken;
      do {
        const params = new URLSearchParams({ q: `trashed = false and 'me' in owners and appProperties has { key='application' and value='emotion-wheel' } and (${query})`,
          fields: 'incompleteSearch,nextPageToken,files(id,name,description,mimeType,createdTime,parents,appProperties,owners(emailAddress))', pageSize: '100', orderBy: 'createdTime asc,name' });
        if (pageToken) params.set('pageToken',pageToken);
        const response = await this.#request(`${API}files?${params}`);
        const result = JSON.parse(await this.#readText(response));
        if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
        if (result.incompleteSearch) throw new Error('Drive returned an incomplete file list. Review the folder before saving or cleaning up.');
        if (!Array.isArray(result.files)) throw new Error('Drive did not return a valid file list.');
        files.push(...result.files); pageToken = result.nextPageToken;
        if (files.length > 10000) throw new Error('Too many managed files. Review your Drive folder.');
      } while (pageToken);
      return files;
    }

    async ensureFolder(name, role, parentId) {
      if (!['root-folder','backups-folder'].includes(role)) throw new Error('Invalid Drive folder role.');
      if (parentId) validFileId(parentId);
      const matches = await this.listManagedFiles(`mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='role' and value='${role}' } and '${parentId || 'root'}' in parents`);
      if (matches.length > 1) throw new Error('More than one Emotion Wheel folder was found. Review them in Drive before saving.');
      if (matches.length) return matches[0];
      const generation = this.#generation;
      const response = await this.#request(`${API}files?fields=id,name`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        name, mimeType:'application/vnd.google-apps.folder', parents:[parentId || 'root'], appProperties:{application:'emotion-wheel',role}
      }) }, 'creating the backup folder');
      const result = JSON.parse(await this.#readText(response));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      validFileId(result.id); return result;
    }

    async getFolderTree() {
      const folder = await this.ensureFolder('Emotion Wheel','root-folder');
      const backups = await this.ensureFolder('Backups','backups-folder',folder.id);
      return { folderId:folder.id, backupsId:backups.id };
    }

    async findExistingCurrent() {
      const folders=await this.listManagedFiles("mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='role' and value='root-folder' } and 'root' in parents");
      if(folders.length>1)throw new Error('More than one Emotion Wheel folder was found. Review them in Drive before updating.');
      return folders.length?this.findCurrent(folders[0].id):null;
    }
    async findExistingBackupFolder() {
      const roots=await this.listManagedFiles("mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='role' and value='root-folder' } and 'root' in parents");
      if(roots.length>1)throw new Error('More than one Emotion Wheel folder was found. Review Drive before managing backups.');
      if(!roots.length)return null;
      const folders=await this.listManagedFiles(`mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='role' and value='backups-folder' } and '${validFileId(roots[0].id)}' in parents`);
      if(folders.length>1)throw new Error('More than one backup folder was found. Review Drive before managing backups.');
      return folders.length?{folderId:roots[0].id,backupsId:folders[0].id}:null;
    }

    async findCurrent(folderId) {
      validFileId(folderId);
      const files = await this.listManagedFiles(`'${folderId}' in parents and appProperties has { key='role' and value='current' }`);
      if (files.length > 1) throw new Error('More than one current file was found. Review them in Drive before saving.');
      return files[0] || null;
    }

    async adoptCurrent(fileId, folderId, ownerEmail) {
      validFileId(fileId); validFileId(folderId);
      const generation = this.#generation;
      const remote = await this.readBackup(fileId);
      if (remote.metadata.trashed || !remote.metadata.owners?.some(owner=>owner.emailAddress===ownerEmail) || remote.metadata.capabilities?.canEdit !== true) throw new Error('Choose an editable file you own for the current file.');
      const params = new URLSearchParams({fields:'id,name,parents,appProperties'});
      if (!remote.metadata.parents?.includes(folderId)) {
        params.set('addParents',folderId);
        if (remote.metadata.parents?.length) params.set('removeParents',remote.metadata.parents.join(','));
      }
      const response = await this.#request(`${API}files/${fileId}?${params}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Emotion Wheel current.json',appProperties:{...remote.metadata.appProperties,application:'emotion-wheel',role:'current'}})}, 'organising the current file');
      const result = JSON.parse(await this.#readText(response));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (result.id !== fileId) throw new Error('Drive did not confirm the current file.');
      return result;
    }

    async listBackups(folderId) {
      validFileId(folderId);
      return this.listManagedFiles(`'${folderId}' in parents and mimeType = 'application/json' and appProperties has { key='role' and value='backup' }`);
    }

    async trashBackup(fileId, folderId, ownerEmail) {
      validFileId(fileId); validFileId(folderId);
      const generation = this.#generation;
      const before = await this.getUpdateState(fileId);
      const remote = await this.readBackup(fileId);
      const after = await this.getUpdateState(fileId);
      if (before.etag !== after.etag) throw new Error('The backup changed. Review the backup list again before moving it to Trash.');
      if (remote.metadata.appProperties?.application !== 'emotion-wheel' || remote.metadata.appProperties?.role !== 'backup' || !remote.metadata.parents?.includes(folderId) || !remote.metadata.owners?.some(owner=>owner.emailAddress===ownerEmail)) throw new Error('Only your managed backups in the Backups folder can be moved to Trash.');
      const response = await this.#request(`${API}files/${fileId}?fields=id,trashed`, { method:'PATCH',headers:{'Content-Type':'application/json','If-Match':after.etag},body:JSON.stringify({trashed:true}) }, 'moving the confirmed backup to Trash');
      const result = JSON.parse(await this.#readText(response));
      if (generation !== this.#generation) throw new Error('Google Drive connection changed.');
      if (result.id !== fileId || result.trashed !== true) throw new Error('Drive did not confirm the move to Trash.');
      return result;
    }

    // v2 exposes the file ETag in JSON, avoiding reliance on CORS-exposed headers.
    // Live stale-ETag rejection must pass before automatic updates are released.
    async findSharedLists() {
      const files=await this.listManagedFiles("mimeType = 'application/json' and appProperties has { key='role' and value='shared-list' }");
      if(files.length>10)throw new Error('Too many shared-list files were found. Review your Drive before continuing.');
      return files;
    }
    async readSharedList(fileId) {
      validFileId(fileId);const generation=this.#generation;
      const response=await this.#request(`${API}files/${fileId}?alt=media`,{redirect:'follow'},'reading your shared-file list');
      const value=JSON.parse(await this.#readText(response));
      if(generation!==this.#generation)throw new Error('Google Drive connection changed.');
      return value;
    }
    async updateSharedList(fileId,list,expectedEtag) {
      validFileId(fileId);
      list=sharedListContent(list);
      if(typeof expectedEtag!=='string' || !/^"[^"\r\n]+"$/.test(expectedEtag))throw new Error('A safe Drive update baseline is required.');
      const generation=this.#generation;
      const response=await this.#request(`https://www.googleapis.com/upload/drive/v2/files/${fileId}?uploadType=media&newRevision=true&fields=id,etag`,{method:'PUT',headers:{'Content-Type':'application/json; charset=UTF-8','If-Match':expectedEtag},body:JSON.stringify(list)},'saving your shared-file list');
      const result=JSON.parse(await this.#readText(response));
      if(generation!==this.#generation)throw new Error('Google Drive connection changed.');
      if(result.id!==fileId || typeof result.etag!=='string' || !/^"[^"\r\n]+"$/.test(result.etag))throw new Error('Shared-file list update is uncertain. Refresh before trying again.');
      return result;
    }
    async createSharedList(list,folderId) {
      validFileId(folderId);
      list=sharedListContent(list);
      const generation=this.#generation,boundary=`emotion_wheel_${root.crypto.randomUUID()}`;
      const metadata={name:'Emotion Wheel shared files.json',mimeType:'application/json',parents:[folderId],appProperties:{application:'emotion-wheel',role:'shared-list'}};
      const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(list)}\r\n--${boundary}--\r\n`;
      const response=await this.#request(`${UPLOAD}files?uploadType=multipart&fields=id,name`,{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body},'creating your shared-file list');
      const result=JSON.parse(await this.#readText(response));
      if(generation!==this.#generation)throw new Error('Google Drive connection changed.');validFileId(result.id);return result;
    }

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

    async createBackup(backup, { name = 'Emotion Wheel backup.json', parentId, role = 'backup', description = '' } = {}) {
      const generation = this.#generation;
      if (!backup || !Array.isArray(backup.entries)) throw new Error('No valid backup to save.');
      const content = JSON.stringify(backup);
      if (new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) {
        throw new Error('The backup is too large to save to Drive. Use a file backup.');
      }
      const boundary = `emotion_wheel_${root.crypto.randomUUID()}`;
      if(typeof name==='string' && name.trim() && role==='backup' && !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z - /.test(name))name=`${new Date().toISOString().replace(/:/g,'-')} - ${name}`;
      if (typeof name !== 'string' || !name.trim() || name.length > 240) throw new Error('Enter a file name of up to 240 characters.');
      if(typeof description!=='string' || description.length>80)throw new Error('Enter a backup comment of up to 80 characters.');
      if (parentId) validFileId(parentId);
      const metadata = { name: name.trim(), mimeType: 'application/json', ...(description?{description}:{}),
        appProperties: { application: 'emotion-wheel', role }, ...(parentId ? { parents: [parentId] } : {}) };
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
