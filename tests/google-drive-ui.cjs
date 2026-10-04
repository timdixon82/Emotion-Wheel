// Exercise the actual UI controller with synthetic Google services and a tiny DOM.
// This deliberately uses no network, credentials or personal records.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { sharingUrl, validFileId } = require('../assets/google-drive.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/google-drive-ui.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: '', innerHTML: '',
      value: '', checked: false, children: [], add(option) { this.children.push(option); }, click() { this.handlers.click?.(); }, reportValidity() { return /^[^@]+@[^@]+\.[^@]+$/.test(this.value); },
      handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; },
      replaceChildren(...children) { this.innerHTML = ''; this.children = children; }, focus() { this.focused = true; } });
    return nodes.get(id);
  };
  const clicks = async id => { node(id).handlers.click(); await flush(); };
  const requests = [], scripts = [], remoteReads = [], uploads = [], grants = [];
  const storage = new Map(); const documentHandlers = {};
  let activeDataset = null, email = 'owner@example.test';
  const personal = { ratingScale: 10, entries: [{ inner: 'Sad', comment: 'Personal synthetic data' }], settings: { mode: 'phase1' } };
  const personalBefore = JSON.stringify(personal);
  let allowConfig = false, tokenOptions, clientInstance, revoked = false, readFailure, finishRead;
  let configOrigin = 'http://localhost:8765';
  let delayRead = false;
  class SyntheticClient {
    constructor() { clientInstance = this; this.connected = false; }
    disconnect() { this.connected = false; revoked = true; }
    setAccessToken() { this.connected = true; }
    getPickerToken() { return 'synthetic-picker-token'; }
    async readBackup(id) {
      remoteReads.push(id);
      if (delayRead) await new Promise(resolve => { finishRead = resolve; });
      if (readFailure) { const error = new Error(readFailure); error.code = 'drive-access'; throw error; }
      return { metadata: { name: 'Emotion Wheel backup.json', owners: [{ emailAddress: 'friend@example.test' }], capabilities: { canShare: false } }, text: JSON.stringify({ ratingScale: 5, entries: [{ inner: 'Happy', comment: '<script>synthetic</script>' }] }) };
    }
    async getConnectedEmail() { return email; }
    async shareWithViewer(fileId, emailAddress, notify) { grants.push({ fileId, emailAddress, notify }); return { role: 'reader', type: 'user', emailAddress }; }
    async createBackup(snapshot) { uploads.push(snapshot); return { id: 'synthetic_drive_file_123' }; }
  }
  const scope = vm.createContext({
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener(type, fn) { documentHandlers[type] = fn; }, getElementById: node, createElement: () => ({ remove() {} }),
      head: { append(script) { scripts.push(script.src); queueMicrotask(() => script.onload()); } } },
    EmotionWheelDrive: { DriveClient: SyntheticClient, sharingUrl, validFileId },
    location: { hostname: 'localhost', origin: 'http://localhost:8765', pathname: '/', search: '', hash: '#drive=synthetic_drive_file_123', href: 'http://localhost:8765/#drive=synthetic_drive_file_123' },
    history: { replaceState(_state, _title, address) { assert.equal(address, '/'); } },
    fetch: async url => { requests.push(url); return { ok: true, json: async () => allowConfig ?
      { clientId: 'synthetic-client', apiKey: 'synthetic-key', appId: '123', origins: [configOrigin] } : {} }; },
    google: { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient(options) { tokenOptions = options; return { ...options,
      requestAccessToken() { tokenOptions.callback({ access_token: 'synthetic', expires_in: 60 }); } }; } } } },
    URL, URLSearchParams, setTimeout, clearTimeout,
    currentAppView: 'maintenance', selectAppView(button) { scope.currentAppView = button; }, maintenanceTab: 'maintenance', logsTab: 'logs', chartsTab: 'charts',
    getReviewDataset: () => activeDataset, setReviewDataset: dataset => { activeDataset = dataset; }, dataSchemaMatches: () => true,
    getBackupSnapshot: () => JSON.parse(JSON.stringify(personal)),
    getBackupEntriesFromText: text => ({ validEntries: JSON.parse(text).entries, ratingScale: JSON.parse(text).ratingScale, skipped: 0 }),
    getLogRows(entries, scale) { assert.equal(scale, 5); return [['Intensity (1–5)'], [entries[0].comment]]; },
    formatRowsAsHtmlTable: (_caption, rows) => JSON.stringify(rows).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    countValues: values => [{ label: values[0], count: values.length }],
    renderBarChart() {}, emotionColours: { Happy: '#000' },
    navigator: { clipboard: { writeText: async text => { assert(text.includes('#drive=')); assert(!text.includes('synthetic-picker-token')); } } },
    showCopyFallback() {}
  });
  vm.runInContext(source, scope);
  assert.equal(requests.length, 0);
  assert.equal(scripts.length, 0);
  assert.equal(remoteReads.length, 0);
  assert.equal(node('saveGoogleDriveButton').disabled, true);
  assert.equal(JSON.stringify(personal), personalBefore);
  await clicks('connectGoogleDriveButton');
  assert.match(node('googleDriveStatus').textContent, /not configured/);
  assert.equal(scripts.length, 0);
  assert.equal(node('connectGoogleDriveButton').disabled, false);
  console.log('PASS: ordinary and shared-link opening are local-only; missing configuration keeps local data and makes no Google requests.');

  allowConfig = true;
  configOrigin = 'https://another-origin.invalid';
  await clicks('connectGoogleDriveButton');
  assert.match(node('googleDriveStatus').textContent, /not configured/);
  assert.equal(scripts.length, 0);
  configOrigin = 'http://localhost:8765';
  await clicks('connectGoogleDriveButton');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0], 'https://accounts.google.com/gsi/client');
  assert.equal(node('connectGoogleDriveButton').textContent, 'Sign in to Google');
  assert.equal(remoteReads.length, 0);
  assert.equal(uploads.length, 0);
  await clicks('connectGoogleDriveButton');
  await flush();
  assert.equal(tokenOptions.scope, 'openid email https://www.googleapis.com/auth/drive.file');
  assert.deepEqual(remoteReads, ['synthetic_drive_file_123']);
  assert.equal(node('googleDriveSharedPreview').hidden, false);
  assert.equal(activeDataset.ratingScale, 5);
  assert.equal(activeDataset.entries[0].comment, '<script>synthetic</script>');
  assert.equal(node('googleAccountStatus').textContent, 'Google Drive connected as owner@example.test.');
  assert.equal(node('googleMaintenanceAccountStatus').textContent, node('googleAccountStatus').textContent);
  assert.equal(scope.currentAppView, 'logs');
  assert.equal(JSON.stringify(personal), personalBefore);
  assert.equal(uploads.length, 0);
  console.log('PASS: explicit connection loads only supported Google scripts, uses per-file scope and opens separate shared preview without personal log/settings mutation or upload.');

  let pickerCallback, pickerVisible = false;
  const pickerOptions = {};
  scope.gapi = { load(_name, options) { options.callback(); } };
  scope.google.picker = { Action: { CANCEL: 'cancel', PICKED: 'picked' },
    DocsView: class { setMimeTypes(types) { pickerOptions.types = types; return this; } },
    PickerBuilder: class {
      setDeveloperKey(value) { pickerOptions.key = value; return this; }
      setAppId(value) { pickerOptions.appId = value; return this; }
      setOAuthToken(value) { pickerOptions.token = value; return this; }
      setOrigin(value) { pickerOptions.origin = value; return this; }
      addView() { return this; }
      setCallback(value) { pickerCallback = value; return this; }
      build() { return { setVisible(value) { pickerVisible = value; } }; }
    }
  };
  await clicks('openGoogleDriveButton');
  assert.equal(pickerVisible, true);
  assert.equal(pickerOptions.origin, 'http://localhost:8765');
  assert.equal(pickerOptions.types, 'application/json,text/plain');
  const readsBeforeWrongFile = remoteReads.length;
  await pickerCallback({ action: 'picked', docs: [{ id: 'wrong_synthetic_file_456' }] }); await flush();
  assert.equal(remoteReads.length, readsBeforeWrongFile + 1);
  assert.equal(activeDataset.fileId, 'wrong_synthetic_file_456');
  assert.equal(pickerVisible, false);
  await clicks('openGoogleDriveButton');
  const picked = { action: 'picked', docs: [{ id: 'synthetic_drive_file_123' }] };
  await pickerCallback(picked); await pickerCallback(picked); await flush();
  assert.equal(remoteReads.length, readsBeforeWrongFile + 2, 'Repeated Picker callbacks must not duplicate reads');
  assert.equal(node('googleDriveSharedPreview').hidden, false);
  readFailure = 'This Google account cannot access the file, or the file is unavailable.';
  await clicks('refreshGoogleDrivePreviewButton');
  assert.equal(node('googleDriveSharedPreview').hidden, true);
  assert(!activeDataset || activeDataset.entries.length === 0);
  assert.match(node('googleDriveStatus').textContent, /cannot access/);
  assert.equal(activeDataset.state, 'unavailable');
  assert.equal(JSON.stringify(personal), personalBefore);
  readFailure = undefined;
  console.log('PASS: Picker uses the app origin, supports additional shared files, deduplicates callbacks and clears stale shared records after denied refresh.');

  await clicks('closeGoogleDrivePreviewButton');
  assert.equal(node('googleDriveSharedPreview').hidden, true);
  assert(!activeDataset || activeDataset.entries.length === 0);
  await clicks('saveGoogleDriveButton');
  assert.deepEqual(uploads, [personal]);
  assert.equal(node('googleDriveSavedPanel').hidden, false);
  assert.equal(node('googleDriveFileLink').href, 'https://drive.google.com/file/d/synthetic_drive_file_123/view');
  await clicks('copyGoogleDriveLinkButton');
  await clicks('shareGoogleDriveCopyButton');
  node('googleDriveRecipientEmail').value = 'viewer@example.test';
  await clicks('reviewGoogleDriveSharingButton');
  assert.equal(grants.length, 0, 'Review must not grant access');
  assert.match(node('googleDriveSharingReview').textContent, /viewer@example.test/);
  assert.match(node('googleDriveSharingReview').textContent, /No email notification/);
  await clicks('cancelGoogleDriveSharingButton');
  await clicks('confirmGoogleDriveSharingButton');
  assert.equal(grants.length, 0, 'Cancelled confirmation must not grant access');
  await clicks('shareGoogleDriveCopyButton');
  node('googleDriveRecipientEmail').value = 'viewer@example.test';
  await clicks('reviewGoogleDriveSharingButton');
  await clicks('confirmGoogleDriveSharingButton');
  assert.deepEqual(grants, [{ fileId: 'synthetic_drive_file_123', emailAddress: 'viewer@example.test', notify: false }]);
  assert.match(node('googleDriveStatus').textContent, /Viewer access granted/);
  await clicks('disconnectGoogleDriveButton');
  assert.equal(clientInstance.connected, false);
  assert.match(node('googleAccountStatus').textContent, /disconnected/);
  assert.equal(revoked, true);
  assert.equal(node('googleDriveSavedPanel').hidden, true);
  assert(!activeDataset || activeDataset.entries.length === 0);
  assert.equal(node('saveGoogleDriveButton').disabled, true);
  assert.equal(JSON.stringify(personal), personalBefore);
  console.log('PASS: saving is explicit; copying uses a file-ID link; close/disconnect discard shared preview and retain personal records.');

  await clicks('connectGoogleDriveButton');
  await clicks('openGoogleDriveButton');
  await pickerCallback({ action: 'cancel' }); await flush();
  assert.equal(pickerVisible, false);
  assert.equal(node('openGoogleDriveButton').disabled, false);
  await clicks('openGoogleDriveButton');
  await clicks('disconnectGoogleDriveButton');
  assert.equal(pickerVisible, false);
  assert.equal(node('connectGoogleDriveButton').disabled, false);
  await clicks('connectGoogleDriveButton');
  delayRead = true;
  await clicks('openGoogleDriveButton');
  const pendingPick = pickerCallback(picked);
  await flush();
  await clicks('disconnectGoogleDriveButton');
  finishRead(); await pendingPick; await flush();
  assert.equal(node('googleDriveSharedPreview').hidden, true);
  assert(!activeDataset || activeDataset.entries.length === 0);
  assert.equal(clientInstance.connected, false);
  assert.equal(JSON.stringify(personal), personalBefore);
  delayRead = false;
  console.log('PASS: Picker cancellation and disconnect release controls; a late download cannot restore a disconnected preview.');

  await clicks('connectGoogleDriveButton'); await flush();
  for (let index = 0; index < 20; index++) {
    await clicks('openGoogleDriveButton');
    await pickerCallback({ action: 'picked', docs: [{ id: `synthetic_shared_file_${index.toString().padStart(3, '0')}` }] }); await flush();
  }
  assert(node('reviewDatasetSelect').children.length >= 21);
  assert.match(node('reviewDatasetStatus').textContent, /Share owner: friend@example.test/);
  assert.equal(node('shareReviewDatasetButton').disabled, true, 'Readers cannot offer sharing of another owner’s file');
  node('reviewDatasetName').value = 'Friend 20'; await clicks('renameReviewDatasetButton');
  assert.equal(activeDataset.label, 'Friend 20');
  const remembered = JSON.parse(storage.get('emotionWheelSharedDatasetsV1'));
  assert(remembered.length >= 20);
  assert(remembered.every(item => Object.keys(item).sort().join() === 'id,label'), 'Only names and file IDs may be persisted');
  assert(!storage.get('emotionWheelSharedDatasetsV1').includes('<script>'));
  const readsBeforeSwitch = remoteReads.length;
  node('reviewDatasetSelect').value = 'synthetic_shared_file_000';
  node('reviewDatasetSelect').handlers.change(); await flush();
  assert.equal(remoteReads.length, readsBeforeSwitch + 1, 'Selecting a remembered file rechecks Drive access');
  assert.equal(activeDataset.fileId, 'synthetic_shared_file_000');
  node('reviewDatasetSelect').value = 'local'; node('reviewDatasetSelect').handlers.change(); await flush();
  assert.equal(activeDataset, null);
  assert(node('reviewDatasetSelect').children.length >= 21);
  delayRead = true;
  node('reviewDatasetSelect').value = 'synthetic_shared_file_001'; node('reviewDatasetSelect').handlers.change(); await flush();
  node('reviewDatasetSelect').value = 'local'; node('reviewDatasetSelect').handlers.change(); await flush();
  finishRead(); await flush();
  assert.equal(activeDataset, null, 'A late download must not override a switch to local data');
  delayRead = false;
  node('reviewDatasetSelect').value = 'synthetic_shared_file_019'; node('reviewDatasetSelect').handlers.change(); await flush();
  await clicks('removeReviewDatasetButton');
  assert.equal(activeDataset, null);
  assert(!JSON.parse(storage.get('emotionWheelSharedDatasetsV1')).some(item => item.id === 'synthetic_shared_file_019'));
  assert.equal(JSON.stringify(personal), personalBefore);
  await clicks('disconnectGoogleDriveButton');
  email = 'second@example.test';
  await clicks('connectGoogleDriveButton'); await flush();
  assert.match(node('googleAccountStatus').textContent, /second@example.test/);
  assert(!node('googleAccountStatus').textContent.includes('owner@example.test'));
  await clicks('disconnectGoogleDriveButton');
  console.log('PASS: 20+ shared files, owner labels, local aliases, permission rechecks, late-switch protection, close/remove and account labels preserve personal data; bookmarks contain only IDs and names.');

  // Closing the Google popup must release the busy controls.
  scope.google.accounts.oauth2.initTokenClient = options => {
    tokenOptions = options;
    return { ...options, requestAccessToken() { options.error_callback({ type: 'popup_closed' }); } };
  };
  await clicks('connectGoogleDriveButton');
  assert.equal(node('connectGoogleDriveButton').disabled, false);
  assert.match(node('googleDriveStatus').textContent, /closed/);
  assert.equal(JSON.stringify(personal), personalBefore);
  console.log('PASS: cancelled Google sign-in restores controls and leaves personal data intact.');

  scope.google.accounts.oauth2.initTokenClient = () => { throw new Error('Synthetic provider initialisation failure'); };
  await clicks('connectGoogleDriveButton');
  assert.equal(node('connectGoogleDriveButton').disabled, false);
  assert.equal(clientInstance.connected, false);
  assert.match(node('googleDriveStatus').textContent, /could not open/);
  console.log('PASS: a Google initialisation failure releases controls and allows a retry.');

  scope.google.accounts.oauth2.hasGrantedAllScopes = () => false;
  scope.google.accounts.oauth2.initTokenClient = options => ({ ...options,
    requestAccessToken() { options.callback({ access_token: 'synthetic', expires_in: 60 }); } });
  await clicks('connectGoogleDriveButton');
  assert.equal(clientInstance.connected, false);
  assert.equal(node('saveGoogleDriveButton').disabled, true);
  assert.match(node('googleDriveStatus').textContent, /not authorised/);
  console.log('PASS: declining the requested Drive scope keeps the app disconnected.');  activeDataset = null;
  const requestsBeforeReload = requests.length, scriptsBeforeReload = scripts.length, readsBeforeReload = remoteReads.length;
  vm.runInContext(source, scope);
  assert(node('reviewDatasetSelect').children.length >= 20);
  assert.equal(activeDataset, null);
  assert.equal(requests.length, requestsBeforeReload);
  assert.equal(scripts.length, scriptsBeforeReload);
  assert.equal(remoteReads.length, readsBeforeReload);
  assert.match(node('googleAccountStatus').textContent, /disconnected/);
  console.log('PASS: reopening restores the dataset list with local data selected and no Google requests, records or remembered account token.');

}
main().catch(error => { console.error(error); process.exitCode = 1; });
