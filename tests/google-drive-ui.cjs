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
      value: '', checked: false, children: [], append(...items) {this.children.push(...items);}, attributes:{},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name]??null;}, remove() {}, add(option) { this.children.push(option); }, click() { this.handlers.click?.(); }, reportValidity() { return /^[^@]+@[^@]+\.[^@]+$/.test(this.value); },
      open:false,showModal(){this.open=true;},close(){this.open=false;},
      handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; },
      replaceChildren(...children) { this.innerHTML = ''; this.children = children; }, focus() { this.focused = true; } });
    return nodes.get(id);
  };
  const clicks = async id => { node(id).handlers.click(); await flush(); };
  const requests = [], scripts = [], remoteReads = [], uploads = [], grants = [], trashed = [];
  const storage = new Map(); const documentHandlers = {};
  let activeDataset = null, email = 'owner@example.test';
  const personal = { ratingScale: 10, entries: [{ inner: 'Sad', comment: 'Personal synthetic data' }], settings: { mode: 'phase1' } };
  const personalBefore = JSON.stringify(personal);
  let allowConfig = false, tokenOptions, clientInstance, revoked = false, readFailure, finishRead;
  let configOrigin = 'http://localhost:8765';
  let delayRead = false, currentFile = null;
  node('googleDriveBackupLimit').value = '5';
  node('googleDriveBackupName').value = 'Emotion Wheel backup';
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
    async getFolderTree() { return {folderId:'synthetic_root_123',backupsId:'synthetic_backups_123'}; }
    async findCurrent() { return currentFile; }
    async listBackups() { return Array.from({length:6},(_,index)=>({id:`synthetic_backup_${index}`,name:`Backup ${index}`,createdTime:`2026-10-0${index+1}T00:00:00Z`})).reverse(); }
    async trashBackup(id) { trashed.push(id); }
    async createBackup(snapshot, options) { uploads.push(snapshot); if(options.role==='current') {currentFile={id:'synthetic_drive_file_123'};return currentFile;}return {id:`synthetic_backup_${uploads.length}`}; }
  }
  const scope = vm.createContext({
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener(type, fn) { documentHandlers[type] = fn; }, getElementById: node, createElement: () => node(`element-${nodes.size}`),
      head: { append(script) { scripts.push(script.src); queueMicrotask(() => script.onload()); } } },
    EmotionWheelDrive: { DriveClient: SyntheticClient, sharingUrl, validFileId },
    location: { hostname: 'localhost', origin: 'http://localhost:8765', pathname: '/', search: '', hash: '', href: 'http://localhost:8765/#drive=synthetic_drive_file_123' },
    window:{addEventListener(type,fn){documentHandlers[type]=fn;}},
    history: { replaceState(_state, _title, address) { assert.equal(address, '/'); } },
    fetch: async url => { requests.push(url); return { ok: true, json: async () => allowConfig ?
      { clientId: 'synthetic-client', apiKey: 'synthetic-key', appId: '123', origins: [configOrigin] } : {} }; },
    google: { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient(options) { tokenOptions = options; return { ...options,
      requestAccessToken() { tokenOptions.callback({ access_token: 'synthetic', expires_in: 60 }); } }; } } } },
    URL, URLSearchParams, setTimeout, clearTimeout,
    currentAppView: 'entry', selectAppView(button) { scope.currentAppView = button; }, maintenanceTab: 'maintenance', sharedDataTab:'shared', logsTab: 'logs', chartsTab: 'charts',
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
  console.log('PASS: ordinary opening is local-only; shared-link sign-in preparation requires valid configuration; missing configuration keeps local data and makes no Google requests.');

  allowConfig = true;
  configOrigin = 'https://another-origin.invalid';
  await clicks('connectGoogleDriveButton');
  assert.match(node('googleDriveStatus').textContent, /not configured/);
  assert.equal(scripts.length, 0);
  configOrigin = 'http://localhost:8765';
  scope.location.hash = '#drive=synthetic_drive_file_123';
  vm.runInContext(source, scope); await flush();
  assert.equal(clientInstance.connected,false,'Preparing sign-in must not connect');
  assert.equal(node('googleDriveLinkPrompt').hidden,false,'A sharing link opens its own separate page');
  assert.equal(scope.currentAppView,'shared','The link opens Data Shared with Me rather than settings');
  assert.match(node('googleDriveLinkMessage').textContent,/Connect your Google account/);
  assert.equal(node('googleDriveLinkSignInButton').textContent,'Connect Google');
  await clicks('googleDriveLinkSignInButton');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0], 'https://accounts.google.com/gsi/client');
  await flush();
  assert.equal(tokenOptions.scope, 'openid email https://www.googleapis.com/auth/drive.file');
  assert.deepEqual(remoteReads, ['synthetic_drive_file_123']);
  assert.equal(node('googleDriveSharedPreview').hidden, false);
  assert.equal(node('googleDriveLinkPrompt').hidden,true,'Successful access closes the sign-in page');
  assert.equal(activeDataset.ratingScale, 5);
  assert.equal(activeDataset.entries[0].comment, '<script>synthetic</script>');
  assert.equal(node('googleAccountStatus').textContent,'Google Connected');
  assert.match(node('googleAccountStatus').getAttribute('aria-label'),/owner@example.test/);
  assert.match(node('googleMaintenanceAccountStatus').textContent,/owner@example.test/);
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
  assert.equal(node('googleDriveBackupCleanup').hidden,false);
  assert.equal(trashed.length,0,'Excess backups must not be trashed automatically');
  assert.equal(node('googleDriveCleanupList').children.length,1);
  assert.match(node('googleDriveCleanupList').children[0].textContent,/Backup 0/);
  await clicks('confirmGoogleDriveCleanupButton');
  assert.deepEqual(trashed,['synthetic_backup_0'],'Only the reviewed oldest backup moves to Trash');
  assert.equal(node('googleDriveSavedPanel').hidden, false);
  await clicks('shareGoogleDriveCopyButton');
  assert.match(node('googleDriveSharingSelectedFile').textContent,/current file/i);
  await clicks('chooseGoogleDriveSharingFileButton');
  await pickerCallback({action:'picked',docs:[{id:'friend_backup_file_123'}]}); await flush();
  assert.match(node('googleDriveStatus').textContent,/file you own/);
  assert.equal(grants.length,0);
  const usualRead=clientInstance.readBackup.bind(clientInstance);
  clientInstance.readBackup=async()=>({metadata:{name:'Older backup.json',owners:[{emailAddress:email}],capabilities:{canShare:true}},text:JSON.stringify({ratingScale:5,entries:[{inner:'Happy',comment:'Synthetic'}]})});
  await clicks('chooseGoogleDriveSharingFileButton');
  await pickerCallback({action:'picked',docs:[{id:'owned_backup_file_123'}]}); await flush();
  assert.match(node('googleDriveSharingSelectedFile').textContent,/Selected backup: Older backup/);
  assert(!storage.get('emotionWheelSharedDatasetsV1').includes('owned_backup_file_123'));
  clientInstance.readBackup=usualRead;
  await clicks('shareGoogleDriveCopyButton');
  node('googleDriveRecipientEmail').value = 'viewer@example.test';
  assert.equal(grants.length,0,'Entering a recipient must not grant access');
  await clicks('cancelGoogleDriveSharingButton');
  await clicks('giveGoogleDriveAccessButton');
  assert.equal(grants.length,0,'Cancelled sharing must not grant access');
  await clicks('shareGoogleDriveCopyButton');
  node('googleDriveRecipientEmail').value='invalid'; await clicks('giveGoogleDriveAccessButton');
  assert.equal(grants.length,0,'Invalid email must not grant access');
  node('googleDriveRecipientEmail').value='viewer@example.test';
  await clicks('giveGoogleDriveAccessButton');
  assert.deepEqual(grants, [{ fileId: 'synthetic_drive_file_123', emailAddress: 'viewer@example.test', notify: false }]);
  assert.match(node('googleDriveStatus').textContent, /Viewer access granted/);
  assert.equal(node('googleDriveSharingResult').hidden,false);
  await clicks('copyGoogleDriveResultLinkButton');
  assert.match(node('googleDriveShareLink').value,/#drive=synthetic_drive_file_123/);
  let sheetCalls=0; scope.navigator.share=async data=>{sheetCalls++;assert.match(data.url,/#drive=/);};
  await clicks('shareGoogleDriveLinkButton'); assert.equal(sheetCalls,1);
  delete scope.navigator.share; await clicks('shareGoogleDriveLinkButton');
  assert.match(node('googleDriveShareSheetStatus').textContent,/copied/);
  assert.equal(node('googleDriveSavedPanel').hidden,true,'Result replaces the initial Share button');
  await clicks('closeGoogleDriveSharingResultButton');
  assert.equal(node('googleDriveSavedPanel').hidden,false);
  assert.equal(node('googleDriveSharingResult').hidden,true);
  await clicks('disconnectGoogleDriveButton');
  assert.equal(clientInstance.connected, false);
  assert.equal(node('googleAccountStatus').textContent,'Google Disconnected');

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
  assert(node('sharedDriveFilesBody').children.every(row=>row.children[2].children.map(button=>button.textContent).join(',')==='View data,Edit name,Refresh,Remove'));
  const lastRow = () => node('sharedDriveFilesBody').children.at(-1);
  const editName = lastRow().children[2].children[1];
  editName.click(); lastRow().children[0].children[0].children[0].value = 'Friend 20'; lastRow().children[0].children[0].children[1].click(); await flush();
  assert.equal(activeDataset.label, 'Friend 20');
  lastRow().children[2].children[1].click();
  let draftField=lastRow().children[0].children[0].children[0];draftField.value='Unfinished name';draftField.handlers.input();
  documentHandlers.reviewdatasetchange();
  assert.equal(lastRow().children[0].children[0].hidden,false);assert.equal(lastRow().children[0].children[0].children[0].value,'Unfinished name');
  assert.equal(lastRow().children[0].colSpan,3);
  lastRow().children[0].children[0].children[2].click();assert.equal(activeDataset.label,'Friend 20');
  const remembered = JSON.parse(storage.get('emotionWheelSharedDatasetsV1'));
  assert(remembered.length >= 20);
  assert(remembered.every(item => Object.keys(item).sort().join() === 'id,label'), 'Only names and file IDs may be persisted');
  assert(!storage.get('emotionWheelSharedDatasetsV1').includes('<script>'));
  scope.currentAppView = 'maintenance';
  node('sharedDriveFilesBody').children[3].children[2].children[2].click(); await flush();
  assert.equal(scope.currentAppView,'maintenance','Refreshing keeps Maintenance open');
  node('sharedDriveFilesBody').children[0].children[2].children[0].click(); await flush();
  assert.equal(scope.currentAppView,'logs','View data switches to Logs');
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
  node('sharedDriveFilesBody').children.at(-1).children[2].children[3].click(); await flush();
  assert.equal(activeDataset, null);
  assert(!JSON.parse(storage.get('emotionWheelSharedDatasetsV1')).some(item => item.id === 'synthetic_shared_file_019'));
  assert.equal(JSON.stringify(personal), personalBefore);
  await clicks('disconnectGoogleDriveButton');
  email = 'second@example.test';
  await clicks('connectGoogleDriveButton'); await flush();
  assert.match(node('googleAccountStatus').getAttribute('aria-label'), /second@example.test/);
  assert(!node('googleAccountStatus').getAttribute('aria-label').includes('owner@example.test'));
  await clicks('disconnectGoogleDriveButton');
  console.log('PASS: 20+ shared files, owner labels, local aliases, permission rechecks, late-switch protection, close/remove and account labels preserve personal data; bookmarks contain only IDs and names.');

  // Exercise the production sync lifecycle with a durable common baseline.
  scope.google.accounts.oauth2.hasGrantedAllScopes = () => true;
  await clicks('connectGoogleDriveButton'); await flush();
  scope.EmotionWheelSync = require('../assets/google-drive-sync.js');
  const syncRecord = (id, comment) => ({ id, inner:'Happy',timestamp:'2026-10-04T10:00:00Z',comment });
  let own = {version:3,schemaVersion:2,ratingScale:5,settings:{mode:'phase1'},tags:[],entries:[syncRecord('first','baseline')]};
  let cloud = structuredClone(own), etag = '"one"', writes = 0;
  scope.getBackupSnapshot = () => structuredClone(own);
  scope.applyDriveSyncSnapshot = (snapshot, expected) => { assert.deepEqual(own,expected); own=structuredClone(snapshot); };
  clientInstance.getUpdateState = async id => ({id,etag,editable:true,owners:[{emailAddress:email}]});
  clientInstance.readBackup = async id => ({metadata:{owners:[{emailAddress:email}],name:'Own backup'},backup:structuredClone(cloud),text:JSON.stringify(cloud)});
  clientInstance.updateBackup = async (id,snapshot,expected) => {
    if (id === '1mJnWuoX58_YY9lzg5jm5t9Kdm1azZpD9' && expected !== etag) { const error=new Error('stale'); error.code='drive-conflict'; throw error; }
    assert.equal(expected,etag); cloud=structuredClone(snapshot); etag='"next"'; writes++; return {id,etag};
  };
  activeDataset = {fileId:'1mJnWuoX58_YY9lzg5jm5t9Kdm1azZpD9',owner:email,entries:[],label:'Synthetic backup'};
  await clicks('testGoogleDriveSyncGuardButton'); await flush();
  assert.match(node('googleDriveSyncStatus').textContent,/protection passed/);
  assert.equal(writes,0,'Stale probe must not update the file');
  activeDataset = {fileId:'synthetic_sync_file_123',owner:email,entries:[],label:'Own backup'};
  currentFile = {id:'synthetic_sync_file_123'};
  await clicks('saveGoogleDriveButton'); await flush();
  await clicks('startGoogleDriveSyncButton');
  await flush();
  assert.match(node('googleDriveSyncStatus').textContent,/Synced 1/);
  assert.equal(node('startGoogleDriveSyncButton').textContent,'Pause Sync');
  assert.equal(node('saveGoogleDriveButton').textContent,'Sync Now');
  assert.match(node('googleDriveLastSyncStatus').textContent,/Last successful sync/);
  assert(storage.has('emotionWheelDriveSyncV1'));
  own.entries.push(syncRecord('local','local add'));
  cloud.entries.push(syncRecord('remote','remote add'));
  await clicks('saveGoogleDriveButton'); await flush();
  assert.equal(own.entries.length,3); assert.equal(cloud.entries.length,3);
  own.entries=own.entries.filter(entry=>entry.id !== 'local');
  await clicks('saveGoogleDriveButton'); await flush();
  assert.equal(cloud.entries.length,2); assert(cloud.driveSync.deletedIds.includes('local'));
  own.entries[0].comment='local conflicting edit'; cloud.entries[0].comment='remote conflicting edit';
  own.entries.push(syncRecord('new-local','device only'));cloud.entries.push(syncRecord('new-remote','Drive only'));
  const beforeConflict = writes;
  await clicks('saveGoogleDriveButton'); await flush();
  assert.equal(writes,beforeConflict); assert.match(node('googleDriveSyncStatus').textContent,/paused/);
  assert.equal(node('googleDriveConflict').hidden,false);
  assert.equal(node('googleDriveSyncSummaryButton').textContent,'Sync Off');
  assert.equal(node('googleDriveSyncIssueBanner').hidden,false);
  await clicks('reviewGoogleDriveSyncIssueButton');
  assert.equal(scope.currentAppView,'maintenance');
  assert.equal(node('googleDriveConflictHeading').focused,true);
  assert.match(node('googleDriveSyncSummaryButton').getAttribute('aria-label'),/Last synced:/);
  await clicks('googleDriveSyncSummaryButton');assert.equal(scope.currentAppView,'maintenance');assert.equal(node('googleDriveConflictHeading').focused,true);
  await clicks('confirmGoogleDriveConflictButton');assert.equal(writes,beforeConflict);
  assert.match(node('googleDriveSyncStatus').textContent,/every conflict/);
  let firstConflict=node('googleDriveConflictRecords').children[0];
  firstConflict.children[4].children[0].handlers.change();
  const uploadsBeforeStale=uploads.length;etag='"newer-review"';
  await clicks('confirmGoogleDriveConflictButton');await flush();
  assert.equal(writes,beforeConflict);assert.equal(uploads.length,uploadsBeforeStale,'Stale review must stop before recovery uploads or writes');
  assert.match(node('googleDriveSyncStatus').textContent,/changed since the review/);
  await clicks('saveGoogleDriveButton');await flush();
  firstConflict=node('googleDriveConflictRecords').children[0];firstConflict.children[4].children[0].handlers.change();
  const createRecovery=clientInstance.createBackup.bind(clientInstance);let recoveryAttempts=0;
  clientInstance.createBackup=async(snapshot,options)=>{if(++recoveryAttempts===2)throw new Error('Synthetic backup failure');return createRecovery(snapshot,options);};
  await clicks('confirmGoogleDriveConflictButton');await flush();
  assert.equal(writes,beforeConflict,'Both recovery files must succeed before resolving a conflict');
  assert.equal(own.entries[0].comment,'local conflicting edit');assert.equal(cloud.entries[0].comment,'remote conflicting edit');
  clientInstance.createBackup=createRecovery;
  await clicks('confirmGoogleDriveConflictButton');await flush();
  assert.equal(writes,beforeConflict+1);
  assert.equal(own.entries.find(entry=>entry.id==='first').comment,'remote conflicting edit');
  assert(own.entries.some(entry=>entry.id==='new-local'));assert(own.entries.some(entry=>entry.id==='new-remote'));
  assert.equal(node('googleDriveConflict').hidden,true);assert(!node('googleAccountStatus').textContent.includes('Sync failed'));
  assert.equal(uploads.at(-2).entries[0].comment,'local conflicting edit');
  assert.equal(uploads.at(-1).entries[0].comment,'remote conflicting edit');
  assert(storage.has('emotionWheelDriveSyncV1ConflictRecovery'));
  const writesAfterResolution=writes;
  await clicks('startGoogleDriveSyncButton');
  const folderProvider=clientInstance.getFolderTree;
  clientInstance.getFolderTree=async()=>{throw new Error('Synthetic folder failure');};
  await clicks('startGoogleDriveSyncButton'); await flush();
  assert.match(node('googleDriveStatus').textContent,/folder failure/);
  assert.equal(node('saveGoogleDriveButton').textContent,'Save to Drive','Failed current-file preparation must not start stale sync');
  assert.equal(writes,writesAfterResolution);
  clientInstance.getFolderTree=folderProvider;
  own.entries[0].comment='manual device edit';cloud.entries[0].comment='manual Drive edit';
  await clicks('saveGoogleDriveButton');await flush();
  assert.equal(node('startGoogleDriveSyncButton').textContent,'Start Sync','Manual conflicts must not enable automatic sync');
  assert.equal(node('saveGoogleDriveButton').textContent,'Save to Drive');
  node('googleDriveConflictRecords').children[0].children[2].children[0].handlers.change();
  await clicks('confirmGoogleDriveConflictButton');await flush();
  assert.equal(own.entries[0].comment,'manual device edit');
  assert.match(node('googleDriveLastSyncStatus').textContent,/automatic sync is off/);
  await clicks('disconnectGoogleDriveButton'); assert.equal(node('saveGoogleDriveButton').disabled,true);
  console.log('PASS: one-click two-way sync persists a baseline, merges both devices, propagates deletions, pauses conflicts and disconnects without overwriting either copy.');
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
  scope.location.hash=''; scope.currentAppView='entry';
  vm.runInContext(source, scope);
  assert(node('reviewDatasetSelect').children.length >= 20);
  assert.equal(activeDataset, null);
  assert.equal(requests.length, requestsBeforeReload);
  assert.equal(scripts.length, scriptsBeforeReload);
  assert.equal(remoteReads.length, readsBeforeReload);
  assert.equal(node('googleAccountStatus').textContent,'Google Disconnected');
  const rememberedFailure=JSON.parse(storage.get('emotionWheelDriveSyncV1'));
  storage.set('emotionWheelDriveSyncV1',JSON.stringify({...rememberedFailure,syncError:'Synthetic stored failure',syncFailedAt:'2026-10-04T10:00:00Z'}));
  vm.runInContext(source,scope);
  assert.equal(node('googleDriveSyncIssueBanner').hidden,false,'An unresolved sync issue survives reload without Google login');
  assert.match(node('googleDriveSyncIssueMessage').textContent,/needs attention/);
  console.log('PASS: reopening restores the dataset list with local data selected and no Google requests, records or remembered account token.');
  scope.google.accounts.oauth2.hasGrantedAllScopes=()=>true;
  await clicks('connectGoogleDriveButton'); await flush();
  clientInstance.readBackup=async id=>({metadata:{name:'Emotion Wheel current.json',owners:[{emailAddress:email}],appProperties:{role:'current'}},text:JSON.stringify(cloud)});
  const uploadsBeforeSharing=uploads.length;
  await clicks('shareGoogleDriveCopyButton'); await flush();
  assert.equal(uploads.length,uploadsBeforeSharing,'Sharing an existing current file must not upload or sync first');
  assert.match(node('googleDriveSharingSelectedFile').textContent,/current file/i);
  assert.equal(node('googleDriveShareOptions').open,false);
  assert.equal(node('googleDriveSavedPanel').hidden,true);
  await clicks('cancelGoogleDriveSharingButton');
  await clicks('disconnectGoogleDriveButton');
  console.log('PASS: streamlined sharing reopens the owned current file without uploading; options start collapsed, cancellation grants nothing and Done returns to one Share button.');
  scope.currentAppView='shared';documentHandlers.appviewchange();await flush();
  const recordsBeforeLinks=JSON.stringify(own),writesBeforeLinks=writes;
  scope.location.hash='#drive=synthetic_drive_file_123';documentHandlers.hashchange();await flush();
  assert.equal(node('googleDriveLinkPrompt').hidden,false);
  assert.equal(scope.location.hash,'#drive=synthetic_drive_file_123','Keep the file link available through a reload until access succeeds');
  await clicks('googleDriveLinkCancelButton');
  assert.equal(node('googleDriveLinkPrompt').hidden,true);
  assert.equal(scope.currentAppView,'logs');
  scope.location.hash='#drive=invalid/link';documentHandlers.hashchange();
  assert.equal(node('googleDriveLinkPrompt').hidden,false);
  assert.equal(node('googleDriveLinkSignInButton').hidden,true);
  assert.match(node('googleDriveLinkMessage').textContent,/cannot be opened/);
  await clicks('googleDriveLinkCancelButton');
  scope.location.hash='#drive=synthetic_drive_file_123';documentHandlers.hashchange();await flush();
  clientInstance.readBackup=async()=>{const error=new Error('Synthetic access denied');error.code='drive-access';throw error;};
  await clicks('googleDriveLinkSignInButton');await flush();
  assert.equal(node('googleDriveLinkPrompt').hidden,false,'Access denial stays in the sharing page');
  assert.match(node('googleDriveLinkMessage').textContent,/cannot open the file/);
  assert.match(node('googleDriveLinkStatus').textContent,/access denied/);
  assert.equal(node('googleDriveLinkSignInButton').textContent,'Switch Google account');
  assert.equal(node('googleDriveLinkAccessPage').hidden,false);
  assert.equal(scope.currentAppView,'shared','Access denial stays on Data Shared with Me');
  await clicks('googleDriveLinkCancelButton');
  assert.equal(JSON.stringify(own),recordsBeforeLinks);
  assert.equal(writes,writesBeforeLinks);
  console.log('PASS: Shared data navigation and focused link login, cancellation, invalid links and access denial preserve local records and avoid settings.');
  scope.dataSchemaVersion=3;scope.storageKey='synthetic-records';
  clientInstance.getUpdateState=async id=>({id,etag,editable:true,owners:[{emailAddress:email}]});
  clientInstance.updateBackup=async(id,snapshot,expected)=>{assert.equal(expected,etag);cloud=structuredClone(snapshot);etag='"schema-next"';writes++;return {id,etag};};
  own.schemaVersion=3;cloud=structuredClone(own);cloud.schemaVersion=2;
  for(const copy of [own,cloud])for(const entry of copy.entries){entry.createdAt=entry.timestamp;entry.modifiedAt=entry.timestamp;}
  storage.set(scope.storageKey,JSON.stringify(own));
  scope.getOriginalBackupSnapshot=()=>({...structuredClone(own),recovery:{rawEntries:storage.get(scope.storageKey)}});
  clientInstance.readBackup=async()=>({metadata:{owners:[{emailAddress:email}],name:'Current'},backup:structuredClone(cloud),text:JSON.stringify(cloud)});
  const backupsBeforeSchema=uploads.length, writesBeforeSchema=writes;
  await clicks('saveGoogleDriveButton');await flush();
  assert.equal(cloud.schemaVersion,3,node('googleDriveSyncStatus').textContent);
  assert.equal(writes,writesBeforeSchema+1);
  assert.equal(uploads.length,backupsBeforeSchema+2,'Older Drive files are backed up with the device before schema conversion');
  assert.equal(uploads.at(-1).schemaVersion,2,'The recovery file keeps the original Drive schema');
  cloud.schemaVersion=4;
  const writesBeforeFuture=writes,backupsBeforeFuture=uploads.length;
  await clicks('saveGoogleDriveButton');await flush();
  assert.match(node('googleDriveSyncStatus').textContent,/newer or unsupported/);
  assert.equal(writes,writesBeforeFuture);assert.equal(uploads.length,backupsBeforeFuture);
  cloud.schemaVersion=3;
  scope.pendingRatingScaleChange={target:10,raw:storage.get(scope.storageKey)};
  const beforeScaleBackup=uploads.length;
  await clicks('driveBeforeScaleChange');await flush();
  assert.equal(uploads.length,beforeScaleBackup+1);
  assert.equal(uploads.at(-1).ratingScale,5);
  assert.equal(node('scaleBackupSaved').checked,true);
  assert.equal(writes,writesBeforeFuture,'An original-rating backup must not merge or overwrite the current file');
  scope.pendingRatingScaleChange=null;
  await clicks('driveBeforeUpgrade');await flush();
  assert.equal(node('continueDataUpgrade').disabled,false);
  const prepared=await scope.window.EmotionWheelDriveUI.prepareLocalUpgrade();
  assert.equal(prepared.schemaVersion,3);
  etag='"changed-after-backup"';
  await assert.rejects(()=>scope.window.EmotionWheelDriveUI.prepareLocalUpgrade(),/Drive changed since the backup/);
  const createOriginal=clientInstance.createBackup;
  clientInstance.createBackup=async()=>{throw new Error('Synthetic original backup failure');};
  node('scaleBackupSaved').checked=false;node('scaleBackupSaved').disabled=true;
  scope.pendingRatingScaleChange={target:10,raw:storage.get(scope.storageKey)};
  await clicks('driveBeforeScaleChange');await flush();
  assert.equal(node('scaleBackupSaved').checked,false);
  assert.match(node('ratingScaleConversionStatus').textContent,/original backup failure/);
  clientInstance.createBackup=createOriginal;
  scope.pendingRatingScaleChange=null;
  scope.dataSchemaMatches=()=>false;
  clientInstance.findExistingCurrent=async()=>currentFile;
  const beforePreflightWrites=writes,beforePreflightUploads=uploads.length;
  await clicks('connectGoogleDriveButton');await flush();
  clientInstance.findExistingCurrent=async()=>currentFile;
  await flush();
  assert.match(node('dataUpgradeStatus').textContent,/Drive checked before the data update/);
  assert.equal(writes,beforePreflightWrites);assert.equal(uploads.length,beforePreflightUploads,'Connect preflight cannot upload originals without the backup action');
  console.log('PASS: original Drive backups gate rating changes; schema upgrades protect both copies, reject stale reviews and future formats, and stop on backup failure.');



}
main().catch(error => { console.error(error); process.exitCode = 1; });
