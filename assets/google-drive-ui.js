/* Optional Drive UI. No Google scripts or requests until an explicit action. */
(function initializeOptionalDrive() {
  'use strict';
  const byId = id => document.getElementById(id);
  const connect = byId('connectGoogleDriveButton');
  const save = byId('saveGoogleDriveButton');
  const open = byId('openGoogleDriveButton');
  const disconnect = byId('disconnectGoogleDriveButton');
  const status = byId('googleDriveStatus');
  const preview = byId('googleDriveSharedPreview');
  const savedPanel = byId('googleDriveSavedPanel');
  const refresh = byId('refreshGoogleDrivePreviewButton');
  const datasetSelect = byId('reviewDatasetSelect');
  const datasetStorageKey = 'emotionWheelSharedDatasetsV1';
  const bookmarks = new Map();
  const fileOwners = new Map();
  const nameDrafts=new Map(),editingNames=new Set(),fileEditButtons=new Map(),fileNameInputs=new Map();
  let changingReview = false;
  try {
    const saved = JSON.parse(localStorage.getItem(datasetStorageKey) || '[]');
    if (Array.isArray(saved)) saved.slice(0, 500).forEach(item => {
      try {
        const id = EmotionWheelDrive.validFileId(item.id);
        if (typeof item.label === 'string' && item.label.trim()) bookmarks.set(id, item.label.trim().slice(0, 120));
      } catch { /* Ignore malformed bookmarks; never interpret them as URLs. */ }
    });
  } catch { /* Local-only use still works when browser storage is unavailable. */ }
  const client = new EmotionWheelDrive.DriveClient();
  const scripts = new Map();
  let config, tokenClient, activePicker, finishPicker, accountExpiryTimer, connectedEmail = '', savedRecordCount = 0, sharingFileId = '';
  let preparingGoogle = false, preparePromise, pickingShareFile = false, sharingIsCurrent = false;
  const googleScopes = 'openid email https://www.googleapis.com/auth/drive.file';
  let accessFileId='', accessOwner='', accessPeopleCount=0, stopSharingPlan;
  let driveTree, cleanupPlan, shareResultFileId = '', linkAccessProblem = false;
  let busy = false, epoch = 0, savedFileId = '', previewFileId = '', linkedFileId = '';
  let invalidSharingLink = false, fileApprovalAttempt = '';
  function receiveSharingLink() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (!fragment.has('drive')) return;
    try { linkedFileId = EmotionWheelDrive.validFileId(fragment.get('drive')); invalidSharingLink=false; }
    catch { linkedFileId=''; invalidSharingLink=true; status.textContent='This sharing link is invalid. Ask the sender for a new Emotion Wheel link.'; }
  }
  receiveSharingLink();
  function clearSharingLink() {
    linkedFileId='';invalidSharingLink=false;
    if(new URLSearchParams(location.hash.slice(1)).has('drive')) history.replaceState(null, '', `${location.pathname}${location.search}`);
  }

  const sharedListKey='emotionWheelSharedListSyncV1';
  let sharedListStore={device:crypto.randomUUID(),owner:'',accounts:Object.create(null),unowned:EmotionWheelSharedList.empty()};
  try {
    const stored=JSON.parse(localStorage.getItem(sharedListKey)||'null');
    if(stored && /^[A-Za-z0-9_-]{1,80}$/.test(stored.device) && typeof stored.owner==='string' && stored.accounts && typeof stored.accounts==='object' && !Array.isArray(stored.accounts)) {
      const accounts=Object.create(null);for(const [owner,value] of Object.entries(stored.accounts))accounts[owner]=EmotionWheelSharedList.validate(value);
      sharedListStore={device:stored.device,owner:stored.owner,accounts,unowned:stored.unowned?EmotionWheelSharedList.validate(stored.unowned):EmotionWheelSharedList.empty()};
    }
  } catch { /* Keep legacy references when preference metadata cannot be read. */ }
  let sharedListItems=sharedListStore.accounts[sharedListStore.owner] || sharedListStore.unowned;
  let sharedListBusy=false,sharedListTimer;
  function saveSharedListState(){
    if(sharedListStore.owner)sharedListStore.accounts[sharedListStore.owner]=sharedListItems;else sharedListStore.unowned=sharedListItems;
    localStorage.setItem(sharedListKey,JSON.stringify(sharedListStore));
  }
  function recordSharedListChanges(){
    for(const [id,label] of bookmarks){const old=sharedListItems.items.find(item=>item.id===id);if(!old || old.deleted || old.label!==label)sharedListItems=EmotionWheelSharedList.change(sharedListItems,id,label,sharedListStore.device);}
    for(const item of sharedListItems.items)if(!item.deleted && !bookmarks.has(item.id))sharedListItems=EmotionWheelSharedList.change(sharedListItems,item.id,null,sharedListStore.device);
    saveSharedListState();scheduleSharedListSync(750);
  }
  function selectSharedListAccount(owner){
    if(sharedListStore.owner!==owner){
      const first=!sharedListStore.owner && Object.keys(sharedListStore.accounts).length===0;
      if(first)recordSharedListChanges();
      sharedListItems=sharedListStore.accounts[owner] || (first?sharedListItems:EmotionWheelSharedList.empty());
      sharedListStore.owner=owner;bookmarks.clear();fileOwners.clear();
      for(const item of sharedListItems.items)if(!item.deleted)bookmarks.set(item.id,item.label);
      localStorage.setItem(datasetStorageKey,JSON.stringify([...bookmarks].map(([id,label])=>({id,label}))));saveSharedListState();update();scheduleSharedListSync(1000);
    }
  }
  function scheduleSharedListSync(delay=15000){
    clearTimeout(sharedListTimer);
    if(!client.connected || !connectedEmail || typeof client.findSharedLists!=='function')return;
    sharedListTimer=setTimeout(syncSharedList,delay);sharedListTimer?.unref?.();
  }
  async function syncSharedList(){
    if(!client.connected || !connectedEmail || typeof client.findSharedLists!=='function')return;
    if(sharedListBusy){scheduleSharedListSync(1000);return;}
    if(busy){scheduleSharedListSync(1000);return;}
    sharedListBusy=true;const operationEpoch=epoch,owner=connectedEmail;
    const output=byId('googleDriveSharedListSyncStatus');output.textContent='Checking your shared-file list in Google Drive…';update();
    const unchanged=()=>epoch===operationEpoch && client.connected && connectedEmail===owner && sharedListStore.owner===owner;
    try {
      const files=await client.findSharedLists();if(!unchanged())return;
      const remote=[];let merged=sharedListItems;
      for(const file of files){
        const before=await client.getUpdateState(file.id);if(!unchanged())return;
        if(!before.editable || !before.owners?.some(item=>item.emailAddress===owner))throw new Error('Only your own editable shared-file list can sync.');
        const value=EmotionWheelSharedList.validate(await client.readSharedList(file.id));if(!unchanged())return;
        const after=await client.getUpdateState(file.id);if(!unchanged())return;
        if(before.etag!==after.etag)throw new Error('The shared-file list changed while reading. It will retry shortly.');
        remote.push({id:file.id,value,etag:after.etag});merged=EmotionWheelSharedList.merge(merged,value);
      }
      merged=EmotionWheelSharedList.merge(merged,sharedListItems);
      if(!files.length && merged.items.length){
        const tree=await client.getFolderTree();if(!unchanged())return;
        await client.createSharedList(merged,tree.folderId);if(!unchanged())return;
      } else for(const file of remote){
        if(JSON.stringify(file.value)!==JSON.stringify(merged)){await client.updateSharedList(file.id,merged,file.etag);if(!unchanged())return;}
      }
      sharedListItems=EmotionWheelSharedList.merge(merged,sharedListItems);saveSharedListState();
      bookmarks.clear();for(const item of sharedListItems.items)if(!item.deleted)bookmarks.set(item.id,item.label);
      localStorage.setItem(datasetStorageKey,JSON.stringify([...bookmarks].map(([id,label])=>({id,label}))));
      const selected=getReviewDataset();if(selected && !bookmarks.has(selected.fileId))chooseLocal();else if(selected && bookmarks.get(selected.fileId)!==selected.label)setDataset({...selected,label:bookmarks.get(selected.fileId)});
      output.textContent=`Shared-file list synced with ${owner}’s Google Drive. Last checked: ${new Date().toLocaleTimeString()}.`;
    } catch(error){if(unchanged())output.textContent=`Shared-file list could not sync: ${error.message} Your local list is kept; retrying in 15 seconds.`;}
    finally {sharedListBusy=false;if(epoch===operationEpoch){update();scheduleSharedListSync();}}
  }
  byId('syncGoogleDriveSharedListButton').addEventListener('click',syncSharedList);
  function persistBookmarks() {
    try {
      localStorage.setItem(datasetStorageKey, JSON.stringify([...bookmarks].map(([id, label]) => ({ id, label }))));
      recordSharedListChanges();
    } catch { status.textContent += ' Dataset names could not be remembered in this browser.'; }
  }
  function setDataset(dataset) {
    changingReview = true;
    try { setReviewDataset(dataset); } finally { changingReview = false; }
  }
  let conflictReview, conflictChoice, lastSyncedAt='', syncError='', syncFailedAt='', feedbackArea='connection';
  let pendingSafetyBackup, schemaUpgradePlan;
  let restorePlan,restoreFiles=new Map(),backupListOwner='',backupListLoaded=false,backupTrashPlan;
  let syncOffer;
  let syncTarget, syncTimer, syncRunning=false, syncWanted=false, syncSafetyVerified = true; // Live stale-ETag rejection verified on the synthetic file.
  const syncStorageKey = 'emotionWheelDriveSyncV1';
  try {const remembered=JSON.parse(localStorage.getItem(syncStorageKey)||'null');if(remembered?.syncError){syncError=remembered.syncError;syncFailedAt=remembered.syncFailedAt||'';lastSyncedAt=remembered.lastSyncedAt||'';}}catch{}
  function update() {
    byId('syncGoogleDriveSharedListButton').disabled=sharedListBusy || !client.connected || !connectedEmail;
    if(syncOffer && (!client.connected || syncOffer.epoch!==epoch || syncOffer.owner!==connectedEmail || syncTarget || getReviewDataset()))syncOffer=undefined;
    byId('googleDriveSyncOffer').hidden=!syncOffer;
    byId('acceptGoogleDriveSyncOfferButton').disabled=busy || !syncOffer || !client.connected;
    byId('declineGoogleDriveSyncOfferButton').disabled=busy;
    if (!client.connected || accessOwner !== connectedEmail) {
      accessFileId=''; accessOwner=''; accessPeopleCount=0; stopSharingPlan=undefined;
      byId('googleDriveAccessBody').replaceChildren(); byId('googleDriveAccessTable').hidden=true;
      byId('googleDriveAccessMessage').textContent=client.connected?'Refresh to see who has access to your current file.':'Connect Google to see who has access.';
    }
    if (stopSharingPlan?.epoch !== epoch) stopSharingPlan=undefined;
    byId('copyGoogleDriveResultLinkButton').disabled=byId('shareGoogleDriveLinkButton').disabled=busy || !client.connected || !accessPeopleCount || !shareResultFileId;
    byId('googleDriveStopSharingPanel').hidden=!stopSharingPlan;
    byId('confirmGoogleDriveStopSharingButton').disabled=busy || !client.connected || !stopSharingPlan;
    byId('cancelGoogleDriveStopSharingButton').disabled=busy;
    byId('refreshGoogleDriveSharingButton').disabled=busy || !client.connected || !connectedEmail;
    byId('sharingConnectGoogleButton').hidden=client.connected;
    byId('sharingConnectGoogleButton').disabled=busy || preparingGoogle;
    if(restorePlan && restorePlan.epoch!==epoch)restorePlan=undefined;
    byId('restoreGoogleDriveBackupButton').disabled=busy || !client.connected || !connectedEmail;
    byId('googleDriveOwnDataPrompt').hidden=!getReviewDataset();
    byId('useLocalDataForDriveButton').disabled=busy;
    if(backupListOwner && backupListOwner!==connectedEmail){restoreFiles=new Map();backupListOwner='';backupListLoaded=false;backupTrashPlan=undefined;restorePlan=undefined;}
    if(backupTrashPlan && backupTrashPlan.epoch!==epoch)backupTrashPlan=undefined;
    byId('googleDriveBackupTrashPanel').hidden=!backupTrashPlan;
    byId('confirmGoogleDriveBackupTrashButton').disabled=busy || !client.connected || !backupTrashPlan;
    byId('cancelGoogleDriveBackupTrashButton').disabled=busy;
    byId('googleDriveBackupComment').disabled=busy;
    renderBackupTable();
    byId('confirmGoogleDriveRestoreButton').disabled=busy || !client.connected || !restorePlan;
    byId('cancelGoogleDriveRestoreButton').disabled=busy;
    if(conflictReview && conflictReview.epoch!==epoch)clearSyncConflict();
    if (cleanupPlan && cleanupPlan.epoch !== epoch) { cleanupPlan=undefined; byId('googleDriveBackupCleanup').hidden=true; }
    connect.disabled = busy || preparingGoogle;
    for(const id of ['driveBeforeUpgrade','driveBeforeScaleChange']){byId(id).textContent=client.connected?'Save original backup to Drive':'Connect Google and back up';byId(id).disabled=busy || preparingGoogle;}
    byId('googleDriveLinkPrompt').hidden=!(linkedFileId || invalidSharingLink) || Boolean(activePicker);
    byId('sharedDataManagement').hidden=Boolean(linkedFileId || invalidSharingLink);
    byId('googleDriveLinkSignInButton').hidden=invalidSharingLink;
    byId('googleDriveLinkStatus').textContent=(linkedFileId || invalidSharingLink)?status.textContent:'';
    byId('googleDriveLinkStatus').hidden=!byId('googleDriveLinkStatus').textContent;
    byId('googleDriveLinkSignInButton').disabled = busy || preparingGoogle;
    byId('googleDriveLinkSignInButton').textContent = client.connected ? (linkAccessProblem ? 'Switch Google account' : 'Try opening again') : 'Connect Google';
    byId('googleDriveLinkPickerButton').hidden = !linkedFileId || !client.connected || !linkAccessProblem;
    byId('googleDriveLinkPickerButton').disabled = busy;
    byId('googleDriveLinkAccessPage').hidden = !linkedFileId || !linkAccessProblem;
    if (linkedFileId) byId('googleDriveLinkAccessPage').href = `https://drive.google.com/file/d/${linkedFileId}/view`;
    byId('googleDriveLinkMessage').textContent = invalidSharingLink ? 'This link cannot be opened. Ask the sender for a new sharing link.' : linkAccessProblem
      ? 'Google needs approval to open this file in Emotion Wheel. The Google approval screen shows only the shared file from your link. Confirm that file to continue. If it is not shown, switch Google account or ask the owner for Viewer access.'
      : client.connected ? `Connected as ${connectedEmail || 'your Google account'}. We will check your access to the shared data.` : 'Connect your Google account to access the shared data. Choose the account the owner shared it with.';

    save.disabled = byId('createGoogleDriveBackupButton').disabled = busy || !client.connected || !connectedEmail || Boolean(getReviewDataset());
    open.disabled = refresh.disabled = busy || !client.connected;
    byId('confirmGoogleDriveCleanupButton').disabled = busy || !cleanupPlan || !client.connected;
    disconnect.disabled = !client.connected && !busy;
    disconnect.hidden = !client.connected && !busy;
    savedPanel.hidden = !client.connected || Boolean(sharingFileId);
    byId('shareGoogleDriveCopyButton').disabled = busy || !connectedEmail || !client.connected;
    byId('chooseGoogleDriveSharingFileButton').disabled = busy || !connectedEmail || !client.connected;
    byId('giveGoogleDriveAccessButton').disabled = busy || !sharingFileId || !client.connected;
    byId('cancelGoogleDriveSharingButton').disabled = busy;
    const syncTime = (syncError ? ` Sync failed${syncFailedAt ? ` at ${new Date(syncFailedAt).toLocaleTimeString()}` : ''} — click to review.` : '') + (lastSyncedAt ? ` Last synced: ${new Date(lastSyncedAt).toLocaleString()}.` : ' No sync time recorded yet.');
    const accountText = client.connected ? (connectedEmail ? `Google Drive connected as ${connectedEmail}.` : 'Google Drive connected; account email is unavailable.') : 'Google Drive is disconnected.';
    byId('googleDriveSyncSummaryButton').textContent=syncRunning && client.connected?'Sync On':'Sync Off';
    byId('googleDriveSyncSummaryButton').setAttribute('aria-label',`${syncRunning && client.connected?'Sync On':'Sync Off'}.${syncTime} Open sync settings in My Data.`);
    byId('googleMaintenanceAccountStatus').textContent = accountText;
    byId('sharedDataAccountStatus').textContent=accountText;
    byId('sharingGoogleAccountStatus').textContent=accountText;
    byId('sharingGoogleConnectionStatus').textContent=status.textContent;
    byId('sharingGoogleConnectionStatus').hidden=feedbackArea!=='connection' || !status.textContent || (client.connected && !busy);
    byId('sharedDataConnectButton').textContent=client.connected?'Switch Google account':'Connect Google';
    byId('sharedDataConnectButton').disabled=busy || preparingGoogle;
    const feedbackId = {connection:'googleDriveConnectionStatus',save:'googleDriveStatus',sync:'googleDriveSyncStatus',files:'googleDriveFilesStatus',share:'googleDriveSharingStatus',restore:'googleDriveRestoreStatus',backups:'googleDriveBackupsStatus'}[feedbackArea];
    byId('sharedDataConnectionStatus').hidden=feedbackArea!=='connection' || !status.textContent || (client.connected && !busy);
    byId('sharedDataConnectionStatus').textContent=status.textContent;
    status.hidden = feedbackArea !== 'save';
    byId('googleDriveConnectionStatus').hidden=feedbackArea!=='connection' || !status.textContent || (client.connected && !busy);
    if (feedbackId !== 'googleDriveStatus') { byId(feedbackId).textContent=status.textContent; byId(feedbackId).hidden=feedbackId==='googleDriveConnectionStatus' && (!status.textContent || (client.connected && !busy)); }
    ['confirmGoogleDriveConflictButton'].forEach(id=>{byId(id).disabled=busy || !client.connected || !conflictReview;});
    const selected = getReviewDataset();
    byId('reviewDatasetPicker').hidden=Boolean(linkedFileId || invalidSharingLink) || (bookmarks.size===0 && !selected);
    byId('reviewDatasetIndicator').hidden=!selected || !['logs','charts'].includes(currentAppView);
    byId('menuToggle').textContent=syncError?'Menu · Sync issue':'Menu';
    byId('googleDriveSyncIssueBanner').hidden=!syncError;
    if(syncError){const message=`Google Drive sync needs attention. ${lastSyncedAt?`Last successful sync: ${new Date(lastSyncedAt).toLocaleString()}.`:'No successful sync time is recorded.'} Review the issue to continue syncing.`;if(byId('googleDriveSyncIssueMessage').textContent!==message)byId('googleDriveSyncIssueMessage').textContent=message;}
    datasetSelect.replaceChildren(new Option('My local data', 'local'));
    bookmarks.forEach((label, id) => datasetSelect.add(new Option(`${label} — ${id.slice(-6)}`, id)));
    if (selected && !bookmarks.has(selected.fileId)) datasetSelect.add(new Option(selected.label, selected.fileId));
    datasetSelect.value = selected?.fileId || 'local';
    renderFileTable();
    byId('startGoogleDriveSyncButton').textContent=syncTarget?'Pause Sync':'Start Sync';
    byId('startGoogleDriveSyncButton').disabled=busy || !client.connected || !connectedEmail || !syncSafetyVerified || (!syncTarget && Boolean(getReviewDataset()));
    save.textContent=syncTarget?'Sync Now':'Save to Drive';
    byId('googleDriveSyncSummaryText').textContent=`Sync status: ${syncError?'needs attention':syncRunning && client.connected?'automatic sync is on':syncTarget?'paused':'automatic sync is off'}. ${lastSyncedAt?`Last successful sync: ${new Date(lastSyncedAt).toLocaleString()}.`:'No successful sync time recorded yet.'}`;
    byId('testGoogleDriveSyncGuardButton').hidden = new URLSearchParams(location.search).get('drive-debug') !== '1' || location.hostname !== 'localhost' || selected?.fileId !== '1mJnWuoX58_YY9lzg5jm5t9Kdm1azZpD9' || selected?.owner !== connectedEmail;
    byId('testGoogleDriveSyncGuardButton').disabled = busy || !client.connected;

    byId('addReviewDatasetButton').disabled = busy;
    byId('reviewDatasetStatus').hidden = true;
    byId('reviewDatasetStatus').textContent = selected
      ? `${selected.label} (read only). ${selected.owner ? `Share owner: ${selected.owner}. ` : ''}${selected.filename ? `File: ${selected.filename}. ` : ''}${status.textContent}` : 'Viewing my local data.';
  }
  function clearPreview() {
    previewFileId = ''; preview.hidden = true;
    byId('googleDriveSharedSummary').textContent = '';
    setDataset(null);
  }
  function showUnavailable(fileId, label, state = 'loading') {
    previewFileId = fileId; preview.hidden = true;
    setDataset({ fileId, label, state, entries: [], tags: [], ratingScale: 5 });
  }
  function closePicker() {
    activePicker?.setVisible(false); activePicker = undefined;
    finishPicker?.(); finishPicker = undefined;
  }
  async function operation(action, message, area='save') {
    if (busy) return;
    const operationEpoch = epoch;
    let requestFileApproval=false;
    feedbackArea=area;
    busy = true; status.textContent = message; update();
    try { return await action(operationEpoch); }
    catch (error) {
      if (epoch === operationEpoch) status.textContent = error instanceof SyntaxError ?
        'The Drive file or connection configuration is invalid. Your local records are kept.' :
        error.message || 'Google Drive is unavailable. Your local records are kept.';
      if(epoch===operationEpoch && (area==='sync' || error.code==='sync-conflict'))recordSyncFailure(error.message);
      if (epoch === operationEpoch && error.code === 'drive-access' && linkedFileId && client.connected) {
        linkAccessProblem = true;selectAppView(sharedDataTab,true);
        status.textContent += ' Google needs approval to open this shared file in Emotion Wheel. The approval screen shows only the file from your link. If it is not shown, switch to the account the owner shared with or request access.';
        const attempt=`${operationEpoch}:${linkedFileId}`;
        if(fileApprovalAttempt!==attempt){fileApprovalAttempt=attempt;requestFileApproval=true;}
      }
    } finally {
      if (epoch === operationEpoch) {
        busy = false; update();
        if(requestFileApproval && client.connected && linkedFileId)open.click();
      }
    }
  }
  async function readConfig() {
    let response;
    if (['localhost', '127.0.0.1'].includes(location.hostname)) {
      response = await fetch('assets/google-drive-config.local.json', { cache: 'no-store', credentials: 'omit' });
    }
    if (!response?.ok) response = await fetch('assets/google-drive-config.json', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('Google Drive is not configured in this preview yet. Local records and file backups are available.');
    const settings = await response.json();
    if (!settings.clientId || !settings.apiKey || !settings.appId ||
      !Array.isArray(settings.origins) || !settings.origins.includes(location.origin)) {
      throw new Error('Google Drive is not configured for this preview yet. Local records and file backups are available.');
    }
    return settings;
  }
  function loadScript(url) {
    if (scripts.has(url)) return scripts.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = url; script.async = true;
      const timeout = setTimeout(() => {
        script.remove(); scripts.delete(url); reject(new Error('Google could not load. Check your connection and try again.'));
      }, 20000);
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => {
        clearTimeout(timeout); script.remove(); scripts.delete(url);
        reject(new Error('Google could not load. Check your connection and try again.'));
      };
      // Google's loader URLs are constants, never values from a sharing link.
      document.head.append(script);
    });
    scripts.set(url, promise); return promise;
  }
  async function openPreview(fileId, operationEpoch, navigate = true) {
    const previousLabel = bookmarks.get(fileId) || `Shared backup — ${fileId.slice(-6)}`;
    showUnavailable(fileId, previousLabel);
    let result, parsed;
    try {
      result = await client.readBackup(fileId);
      if (epoch !== operationEpoch) return;
      parsed = getBackupEntriesFromText(result.text);
    } catch (error) {
      if (epoch === operationEpoch) showUnavailable(fileId, previousLabel, 'unavailable');
      throw error;
    }
    if (epoch !== operationEpoch) return;
    const ownerInfo = result.metadata.owners?.[0];
    const owner = typeof ownerInfo?.emailAddress === 'string' ? ownerInfo.emailAddress :
      typeof ownerInfo?.displayName === 'string' ? ownerInfo.displayName : '';
    const filename = result.metadata.name || 'Shared backup';
    const label = bookmarks.get(fileId) || `${owner ? `${owner} · ` : ''}${filename}`.slice(0, 120);
    fileOwners.set(fileId, owner);
    bookmarks.set(fileId, label);
    persistBookmarks();
    setDataset({ fileId, label, filename, owner, canShare: result.metadata.capabilities?.canShare === true, entries: parsed.validEntries, ratingScale: parsed.ratingScale, tags: parsed.tags || [], state: 'loaded' });
    byId('googleDriveSharedSummary').textContent = `${label}: ${parsed.validEntries.length} records, rating scale 1–${parsed.ratingScale}. ${parsed.skipped} invalid records skipped. Use the dataset selector to switch between shared files and your local data.`;
    previewFileId = fileId; preview.hidden = false;
    clearSharingLink(); linkAccessProblem = false;
    if (navigate && !['logs', 'charts'].includes(currentAppView)) selectAppView(logsTab, true);
    status.textContent = `Shared dataset refreshed from Drive at ${new Date().toLocaleTimeString()}. Your local records and settings are kept.`;
  }
  function chooseLocal() {
    feedbackArea='files'; epoch++; busy = false; resetSharing(); closePicker(); clearPreview(); clearSharingLink();
    status.textContent = 'Viewing my local data. Shared files remain in the dataset list.'; update();
  }
  function chooseShared(fileId, navigate = true) {
    feedbackArea='files'; linkAccessProblem = false;
    epoch++; busy = false; resetSharing(); closePicker(); linkedFileId = fileId;
    showUnavailable(fileId, bookmarks.get(fileId) || 'Shared backup');
    if (!client.connected) {
      showUnavailable(fileId, bookmarks.get(fileId) || 'Shared backup', 'unavailable');
      status.textContent = 'Connect Google to load this dataset. No local data is changed.';selectAppView(sharedDataTab,true);update();return;
    }
    operation(operationEpoch => openPreview(fileId, operationEpoch, navigate), 'Loading the selected shared dataset…','files');
  }
  byId('reviewDatasetIndicator').addEventListener('click',()=>{setMenuOpen(true);datasetSelect.focus();});
  datasetSelect.addEventListener('change', () => {
    if(typeof setMenuOpen==='function')setMenuOpen(false);
    if (datasetSelect.value === 'local') chooseLocal();
    else if (bookmarks.has(datasetSelect.value)) chooseShared(datasetSelect.value);
  });
  document.addEventListener('reviewdatasetchange', () => {
    if (changingReview) return;
    if (!getReviewDataset()) chooseLocal();
    else update();
  });
  byId('addReviewDatasetButton').addEventListener('click', () => {
    if (client.connected) { pickingShareFile=false; linkedFileId = ''; open.click(); }
    else { selectAppView(sharedDataTab, true); feedbackArea='files';status.textContent = 'Connect Google, then choose Add a Drive file. You can also open a sharing link from the owner.'; update(); byId('sharedDataConnectButton').focus(); }
  });
  function renderFileTable() {
    const activeName=document.activeElement?.getAttribute?.('data-drive-name');
    const selectionStart=document.activeElement?.selectionStart,selectionEnd=document.activeElement?.selectionEnd;
    const body = byId('sharedDriveFilesBody');
    body.replaceChildren();
    byId('sharedDriveFilesEmpty').hidden = bookmarks.size > 0;
    byId('sharedDriveFilesTable').hidden = bookmarks.size === 0;
    bookmarks.forEach((label, id) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');name.setAttribute('data-label','Name'); name.textContent = label;
      const owner = document.createElement('td');owner.setAttribute('data-label','Owner'); owner.textContent = fileOwners.get(id) || 'Shown when opened';
      const actions = document.createElement('td');actions.setAttribute('data-label','Actions');actions.className='drive-file-actions';
      const button = (text, action, requiresConnection = false) => {
        const control = document.createElement('button'); control.type = 'button'; control.textContent = text;
        control.setAttribute('aria-label', `${text}: ${label}`);
        control.disabled = busy || (requiresConnection && !client.connected);
        control.addEventListener('click', action); actions.append(control); return control;
      };
      button('View data', () => {
        if (!client.connected) { chooseShared(id); }
        else { selectAppView(logsTab, true); chooseShared(id); }
      });
      const editor=document.createElement('div'); editor.className='drive-name-editor'; editor.hidden=!editingNames.has(id);
      const input = document.createElement('input'); input.type = 'text'; input.className='drive-name-input'; input.maxLength = 120; input.value = nameDrafts.get(id)||label;
      input.setAttribute('aria-label', `Name for ${label}`);input.setAttribute('data-drive-name',id);fileNameInputs.set(id,input);
      const saveName=document.createElement('button');saveName.type='button';saveName.textContent='Save name';
      const cancelName=document.createElement('button');cancelName.type='button';cancelName.textContent='Cancel';
      editor.append(input,saveName,cancelName);name.append(editor);
      const edit = button('Edit name', () => {editingNames.add(id);editor.hidden=false;edit.hidden=true;name.colSpan=3;owner.hidden=true;actions.hidden=true;input.focus();});
      edit.hidden=editingNames.has(id);fileEditButtons.set(id,edit);
      if(editingNames.has(id)){name.colSpan=3;owner.hidden=true;actions.hidden=true;}
      input.addEventListener('input',()=>nameDrafts.set(id,input.value));
      saveName.addEventListener('click',()=>{
        const renamed=input.value.trim().slice(0,120);if(!renamed){input.focus();return;}
        bookmarks.set(id,renamed);editingNames.delete(id);nameDrafts.delete(id);persistBookmarks();const selected=getReviewDataset();
        if(selected?.fileId===id)setDataset({...selected,label:renamed});
        feedbackArea='files';status.textContent='File name saved in this browser.';update();fileEditButtons.get(id)?.focus();
      });
      cancelName.addEventListener('click',()=>{editingNames.delete(id);nameDrafts.delete(id);editor.hidden=true;edit.hidden=false;name.colSpan=1;owner.hidden=false;actions.hidden=false;input.value=label;edit.focus();});
      input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();saveName.click();}else if(event.key==='Escape'){cancelName.click();}});
      button('Refresh', () => chooseShared(id, false), true);
      button('Remove', () => {
        feedbackArea='files';bookmarks.delete(id); fileOwners.delete(id); persistBookmarks();
        if (getReviewDataset()?.fileId === id) chooseLocal();
        status.textContent = 'File removed from your list. It is kept in Google Drive.'; update(); byId('addReviewDatasetButton').focus();
      });
      row.append(name,owner,actions); body.append(row);
    });
    if(activeName && editingNames.has(activeName)){const field=fileNameInputs.get(activeName);field?.focus();field?.setSelectionRange?.(selectionStart,selectionEnd);}
  }
  async function copyLink(fileId) {
    feedbackArea='share';
    if (!fileId) return;
    const url = EmotionWheelDrive.sharingUrl(location.href, fileId);
    try { await navigator.clipboard.writeText(url); status.textContent = 'Emotion Wheel link copied. Only people with Drive access can open it.'; update(); return true; }
    catch { showCopyFallback('Copy Emotion Wheel sharing link', url, 'Select and copy this link. The recipient needs Viewer access in Google Drive.'); return false; }
  }

  function prepareGoogle() {
    if (tokenClient) return Promise.resolve();
    if (preparePromise) return preparePromise;
    preparingGoogle = true; status.textContent = 'Preparing Google sign-in…'; update();
    preparePromise = (async()=>{
      const settings = await readConfig();
      await loadScript('https://accounts.google.com/gsi/client');
      config = settings;
      tokenClient = google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:googleScopes,callback:()=>{}});
      connect.textContent = 'Connect Google Drive';
      status.textContent = '';
    })().finally(()=>{ preparingGoogle=false;preparePromise=undefined;update(); });
    return preparePromise;
  }
  document.addEventListener('appviewchange',()=>{
    update();
    if (['maintenance','shared','sharing'].includes(currentAppView) && !tokenClient) prepareGoogle().catch(error=>{status.textContent=error.message;update();});
    if(currentAppView==='sharing')refreshSharingAccess();
    refreshVisibleBackups();
  });
  function refreshVisibleBackups(){
    if(currentAppView!=='maintenance' || !client.connected || !connectedEmail || busy || typeof client.findExistingBackupFolder!=='function')return;
    operation(async operationEpoch=>{await refreshBackupList(operationEpoch);if(epoch===operationEpoch)status.textContent='Backup list refreshed from Google Drive.';},'Refreshing backups from Google Drive…','backups');
  }
  window.addEventListener('focus',()=>{refreshVisibleBackups();syncSharedList();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshVisibleBackups();syncSharedList();}});
  byId('sharedDataConnectButton').addEventListener('click',()=>connect.click());
  connect.addEventListener('click', () => {
    if (!tokenClient) {
      prepareGoogle().then(()=>connect.click()).catch(error=>{status.textContent=error.message;update();});
      return;
    }
    if (busy) return;
    const connectedFromShared=Boolean(getReviewDataset());
    feedbackArea='connection'; epoch++; const requestEpoch = epoch;
    driveTree = undefined; cleanupPlan = undefined; byId('googleDriveBackupCleanup').hidden = true;
    pauseSync(); client.disconnect(); clearTimeout(accountExpiryTimer); connectedEmail = ''; resetSharing(); savedFileId = ''; savedPanel.hidden = true; clearPreview();
    busy = true; status.textContent = 'Waiting for Google account selection and authorisation…';update();
    tokenClient.callback = async response => {
      if (epoch !== requestEpoch) return;
      busy = false;
      if (response.error || !google.accounts.oauth2.hasGrantedAllScopes(response, 'https://www.googleapis.com/auth/drive.file')) {
        pendingSafetyBackup=undefined;status.textContent = 'Google connection was not authorised. Local records and file backups are available.';
      } else {
        try {
          client.setAccessToken(response);
          accountExpiryTimer = setTimeout(update, Math.max(0, Number(response.expires_in) * 1000 - 5000));
          accountExpiryTimer?.unref?.();
          busy = true;
          status.textContent = 'Checking the connected Google account…'; update();
          try { const email = await client.getConnectedEmail(); if (epoch === requestEpoch) { connectedEmail = email; lastSyncedAt='';syncError='';syncFailedAt=''; try {const remembered=JSON.parse(localStorage.getItem(syncStorageKey)||'null');if(remembered?.owner===email){syncError=remembered.syncError||'';syncFailedAt=remembered.syncFailedAt||'';}if(remembered?.owner===email && remembered.lastSyncedAt && Number.isFinite(Date.parse(remembered.lastSyncedAt))) lastSyncedAt=remembered.lastSyncedAt;} catch {} } }
          catch { if (epoch === requestEpoch) connectedEmail = ''; }
          if (epoch !== requestEpoch) return;
          busy = false;
          if (!client.connected) throw new Error('Reconnect Google Drive to continue.');
          if(connectedEmail && typeof client.findSharedLists==='function')selectSharedListAccount(connectedEmail);
          if(syncError){byId('googleDriveSyncStatus').textContent='The previous sync failed. Choose Save to Drive to review the latest copies.';byId('googleDriveSyncStatus').hidden=false;}
          connect.textContent = 'Reconnect or switch Google account';
          status.textContent = 'Google Drive connected. Choose Save to Drive, Create dated backup or Start Sync.';
          if(pendingSafetyBackup){const kind=pendingSafetyBackup;pendingSafetyBackup=undefined;backupBeforeChange(kind);}
          else if (linkedFileId) operation(operationEpoch => openPreview(linkedFileId, operationEpoch), 'Opening the shared backup…');
          else if(!dataSchemaMatches())checkDriveBeforeUpgrade();
          else if(currentAppView==='sharing')await refreshSharingAccess();
          else if(currentAppView==='maintenance' && typeof client.findExistingBackupFolder==='function')await operation(refreshBackupList,'Loading your dated backups…','backups');
          if(epoch===requestEpoch && connectedEmail && typeof client.findSharedLists==='function'){selectSharedListAccount(connectedEmail);await syncSharedList();}
          if(epoch===requestEpoch && !busy && !connectedFromShared && !linkedFileId && currentAppView!=='shared' && !getReviewDataset() && dataSchemaMatches())await offerExistingSync();
        } catch (error) { busy = false; status.textContent = error.message; }
      }
      update();
    };
    // GIS captures error_callback at initialisation.
    const failed = () => {
      if (epoch !== requestEpoch) return;
      pendingSafetyBackup=undefined;busy = false; status.textContent = 'Google sign-in was closed or could not open. Try again; your local records are kept.'; update();
    };
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({ client_id: config.clientId,
        scope: googleScopes, callback: tokenClient.callback, error_callback: failed });
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    } catch { failed(); }
  });
  async function prepareSyncSchemas(base,local,remote) {
    if(typeof dataSchemaVersion==='undefined')return {base,local,remote,upgraded:false};
    for(const copy of [base,local,remote].filter(Boolean)) {
      const parsed=getBackupEntriesFromText(JSON.stringify(copy));
      if(parsed.skipped || parsed.validEntries.length!==copy.entries.length || copy.entries.some((entry,index)=>entry.id && parsed.validEntries[index].id!==entry.id))throw new Error('A sync copy contains invalid records. Both copies are kept for review.');
    }
    return EmotionWheelSync.prepareSchemas(base,local,remote,dataSchemaVersion);
  }
  async function preserveSchemaCopies(local,remote,operationEpoch) {
    localStorage.setItem(`${syncStorageKey}SchemaRecovery`,JSON.stringify({local,remote,savedAt:new Date().toISOString()}));
    driveTree=await client.getFolderTree();if(epoch!==operationEpoch)return false;
    const date=new Date().toISOString().replace(/:/g,'-');
    for(const [name,copy] of [['device',local],['Drive',remote]]) {
      await client.createBackup(copy,{name:`${date} - Before data update ${name}.json`,parentId:driveTree.backupsId,role:'backup'});
      if(epoch!==operationEpoch)return false;
    }
    return true;
  }
  async function checkDriveBeforeUpgrade() {
    await operation(async operationEpoch=>{
      const current=await client.findExistingCurrent();if(epoch!==operationEpoch)return;
      if(!current){status.textContent='No current Drive file was found. Save an original backup before updating this device.';return;}
      const before=await client.getUpdateState(current.id),remote=await client.readBackup(current.id),after=await client.getUpdateState(current.id);
      if(epoch!==operationEpoch)return;
      if(before.etag!==after.etag || !before.editable || !before.owners?.some(owner=>owner.emailAddress===connectedEmail))throw new Error('Drive changed or cannot be updated by this account. Check it again before updating this device.');
      const copies=await prepareSyncSchemas(rememberedBaseline(current.id),getOriginalBackupSnapshot(),remote.backup);
      const conflicts=EmotionWheelSync.getConflicts(copies.base,copies.local,copies.remote);
      status.textContent=`Drive checked before the data update. ${conflicts.length?'Some changes will need your choice after updating. ':''}Save the original backups to Drive, then confirm the update. Both copies are kept until you choose.`;
    },'Checking your latest Drive data before updating this device…','connection');
    byId('dataUpgradeStatus').textContent=status.textContent;
  }
  async function backupBeforeChange(kind) {
    const output=byId(kind==='upgrade'?'dataUpgradeStatus':'ratingScaleConversionStatus');
    if(!client.connected || !connectedEmail){pendingSafetyBackup=kind;output.textContent='Connect your Google account to save the original backup.';connect.click();return;}
    if(busy)return;
    output.textContent='Checking Drive and saving the original backup…';
    let succeeded=false;
    await operation(async operationEpoch=>{
      if(kind==='scale' && (!pendingRatingScaleChange || localStorage.getItem(storageKey)!==pendingRatingScaleChange.raw))throw new Error('The log changed. Cancel and choose the rating scale again.');
      const original=getOriginalBackupSnapshot(),raw=localStorage.getItem(storageKey);
      driveTree=await client.getFolderTree();if(epoch!==operationEpoch)return;
      if(kind==='upgrade') {
        const current=await client.findCurrent(driveTree.folderId);if(epoch!==operationEpoch)return;
        schemaUpgradePlan=undefined;
        if(current) {
          const before=await client.getUpdateState(current.id),remote=await client.readBackup(current.id),after=await client.getUpdateState(current.id);
          if(epoch!==operationEpoch)return;
          if(!before.editable || !before.owners?.some(owner=>owner.emailAddress===connectedEmail) || before.etag!==after.etag)throw new Error('Drive changed or belongs to another account. Try checking again before updating.');
          const copies=await prepareSyncSchemas(rememberedBaseline(current.id),original,remote.backup);
          if(!await preserveSchemaCopies(original,remote.backup,operationEpoch))return;
          schemaUpgradePlan={id:current.id,etag:after.etag,raw,local:copies.local,owner:connectedEmail};
        }
      }
      if(!schemaUpgradePlan || kind==='scale')await client.createBackup(original,{name:`${new Date().toISOString().replace(/:/g,'-')} - Before ${kind==='scale'?'rating change':'data update'}.json`,parentId:driveTree.backupsId,role:'backup'});
      if(epoch!==operationEpoch)return;
      if(localStorage.getItem(storageKey)!==raw)throw new Error('Your records changed during backup. Save a fresh backup before continuing.');
      if(kind==='upgrade') {
        if(original.schemaVersion>dataSchemaVersion)throw new Error('Use the newer app version to update this data. The original backup was saved.');
        byId('continueDataUpgrade').disabled=false;
      } else {byId('scaleBackupSaved').disabled=false;byId('scaleBackupSaved').checked=true;byId('confirmScaleChange').disabled=false;}
      succeeded=true;status.textContent=kind==='upgrade'?'Original backups saved. Drive was checked before the update; changes will be merged after you confirm.':'Original ratings backed up to Google Drive. You can now confirm the scale change.';
    },'Saving the original data to Drive…','save');
    output.textContent=status.textContent;
    if(!succeeded && kind==='upgrade')schemaUpgradePlan=undefined;
  }
  for(const [id,kind] of [['driveBeforeUpgrade','upgrade'],['driveBeforeScaleChange','scale']])byId(id).addEventListener('click',()=>backupBeforeChange(kind));
  window.EmotionWheelDriveUI={
    async prepareLocalUpgrade(){
      const plan=schemaUpgradePlan;if(!plan)return;
      if(!client.connected || connectedEmail!==plan.owner || localStorage.getItem(storageKey)!==plan.raw)throw new Error('Reconnect and save a fresh original backup before updating.');
      const beforeEpoch=epoch;const state=await client.getUpdateState(plan.id);
      if(epoch!==beforeEpoch || schemaUpgradePlan!==plan || localStorage.getItem(storageKey)!==plan.raw)throw new Error('A copy changed during the check. Save a fresh backup before updating.');
      if(state.etag!==plan.etag || !state.editable || !state.owners?.some(owner=>owner.emailAddress===plan.owner))throw new Error('Drive changed since the backup. Check Drive and back up again before updating.');
      return plan.local;
    },
    afterLocalUpgrade(){if(schemaUpgradePlan){schemaUpgradePlan=undefined;save.click();}}
  };
  function rememberedBaseline(fileId) {
    if (syncTarget?.id === fileId && syncTarget.owner === connectedEmail) return syncTarget.base;
    try { const saved = JSON.parse(localStorage.getItem(syncStorageKey) || 'null'); if (saved?.id === fileId && saved.owner === connectedEmail) return saved.base; } catch {}
    return null;
  }
  async function saveCurrent(operationEpoch) {
    if(getReviewDataset())throw new Error('Switch to My local data before saving or starting sync.');
    if (!dataSchemaMatches() || !connectedEmail) throw new Error('Complete the local data upgrade and connect your Google account before saving.');
    if ((typeof editingEntry !== 'undefined' && editingEntry) || (typeof pendingRatingScaleChange !== 'undefined' && pendingRatingScaleChange)) throw new Error('Finish the current edit or scale review before saving to Drive.');
    const snapshot = getBackupSnapshot();
    driveTree = await client.getFolderTree();
    if (epoch !== operationEpoch) return;
    let current = await client.findCurrent(driveTree.folderId);
    if (epoch !== operationEpoch) return;
    if(!current && syncTarget)throw new Error('Your current Drive file is missing. Pause sync and review your Drive folder before saving.');
    let merged = snapshot;
    if (current) {
      if (syncTarget && syncTarget.id !== current.id) throw new Error('Pause sync with the other file before saving the current file.');
      const before = await client.getUpdateState(current.id);
      const remote = await client.readBackup(current.id);
      const after = await client.getUpdateState(current.id);
      if (epoch !== operationEpoch) return;
      if (!before.editable || !before.owners?.some(owner=>owner.emailAddress===connectedEmail) || before.etag !== after.etag) throw new Error('The current Drive file changed or is not editable by this account. Try again.');
      const parsed = getBackupEntriesFromText(remote.text);
      if (parsed.skipped) throw new Error('The current file needs review before saving.');
      const copies=await prepareSyncSchemas(rememberedBaseline(current.id),snapshot,remote.backup);
      if(epoch!==operationEpoch)return;
      if(copies.upgraded && !await preserveSchemaCopies(snapshot,remote.backup,operationEpoch))return;
      try { merged = EmotionWheelSync.reconcile(copies.base, copies.local, copies.remote); }
      catch(error) { if(error.code==='sync-conflict') showSyncConflict({id:current.id,owner:connectedEmail,base:copies.base,local:snapshot,remote:copies.remote,etag:after.etag},error); throw error; }
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(getBackupSnapshot())) !== EmotionWheelSync.canonical(EmotionWheelSync.content(snapshot))) throw new Error('Local data changed during saving. Try again.');
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(merged)) !== EmotionWheelSync.canonical(EmotionWheelSync.content(remote.backup)) || EmotionWheelSync.canonical(merged.driveSync) !== EmotionWheelSync.canonical(remote.backup.driveSync)) await client.updateBackup(current.id,{...merged,exportedAt:new Date().toISOString()},after.etag);
      if (epoch !== operationEpoch) return;
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(merged)) !== EmotionWheelSync.canonical(EmotionWheelSync.content(snapshot))) applyDriveSyncSnapshot(merged,snapshot);
    } else {
      current = await client.createBackup(snapshot,{name:'Emotion Wheel current.json',parentId:driveTree.folderId,role:'current'});
      if (epoch !== operationEpoch) return;
      const unique = await client.findCurrent(driveTree.folderId);
      if (!unique || unique.id !== current.id) throw new Error('The current-file list changed. Review the folder before saving again.');
    }
    if (epoch !== operationEpoch) return;
    lastSyncedAt=new Date().toISOString();syncError='';syncFailedAt='';
    localStorage.setItem(syncStorageKey,JSON.stringify({id:current.id,owner:connectedEmail,base:merged,lastSyncedAt}));
    if (syncTarget?.id === current.id) syncTarget.base = merged;
    savedFileId = current.id; savedRecordCount = merged.entries.length; resetSharing();
    savedPanel.hidden = false;
    return {current,snapshot:merged};
  }
  async function reviewBackups(operationEpoch) {
    if (!driveTree) return;
    const limit = Number(byId('googleDriveBackupLimit').value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose a backup limit between 1 and 100.');
    const files = await client.listBackups(driveTree.backupsId);
    if (epoch !== operationEpoch) return;
    restoreFiles=new Map(files.map(file=>[file.id,file]));backupListOwner=connectedEmail;backupListLoaded=true;
    if(restorePlan && !restoreFiles.has(restorePlan.id)){restorePlan=undefined;byId('googleDriveRestoreSummary').textContent='This backup is no longer in Drive. Choose another backup from the list.';}
    if(backupTrashPlan && !restoreFiles.has(backupTrashPlan.id))backupTrashPlan=undefined;
    const sorted = files.slice().sort((a,b)=>String(a.createdTime).localeCompare(String(b.createdTime)) || a.id.localeCompare(b.id));
    const extra = sorted.slice(0,Math.max(0,sorted.length-limit));
    cleanupPlan = extra.length ? {files:extra,folderId:driveTree.backupsId,owner:connectedEmail,epoch} : undefined;
    byId('googleDriveBackupCleanup').hidden = !cleanupPlan;
    byId('googleDriveCleanupList').replaceChildren();
    if (cleanupPlan) {
      byId('googleDriveCleanupSummary').textContent = `You have ${files.length} backups. Keep the newest ${limit}? These ${extra.length} oldest backups can be moved to Trash. The current file will be kept.`;
      extra.forEach(file=>{const item=document.createElement('li');item.textContent=`${file.name} — ${file.createdTime || 'date unavailable'}`;byId('googleDriveCleanupList').append(item);});
      if(feedbackArea==='save')byId('googleDriveCleanupHeading').focus();
    }
  }
  const sameRestoreLocal=plan=>EmotionWheelSync.canonical(EmotionWheelSync.content(getBackupSnapshot()))===EmotionWheelSync.canonical(EmotionWheelSync.content(plan.local));
  const requireRestoreReady=()=>{
    if(getReviewDataset())throw new Error('Switch to My local data before restoring your own backup.');
    if(!dataSchemaMatches() || (typeof editingEntry!=='undefined' && editingEntry) || (typeof pendingRatingScaleChange!=='undefined' && pendingRatingScaleChange))throw new Error('Finish your current edit or data update before restoring.');
  };
  function renderBackupTable() {
    const body=byId('googleDriveBackupsBody');body.replaceChildren();
    byId('googleDriveBackupListMessage').textContent=!client.connected?'Connect Google to see your dated backups.':!backupListLoaded?'Choose Refresh backups to see your dated copies.':restoreFiles.size?`${restoreFiles.size} dated backups. Your current synced file is separate and is never deleted by cleanup.`:'No dated backups found. Choose Create dated backup to save one.';
    if(!client.connected || backupListOwner!==connectedEmail)return;
    const files=[...restoreFiles.values()].sort((a,b)=>String(b.createdTime).localeCompare(String(a.createdTime)) || a.id.localeCompare(b.id));
    for(const file of files){
      const row=document.createElement('tr'),name=document.createElement('td'),date=document.createElement('td'),comment=document.createElement('td'),actions=document.createElement('td');
      name.setAttribute('data-label','Backup name');name.textContent=file.name;
      date.setAttribute('data-label','Created');date.textContent=Number.isFinite(Date.parse(file.createdTime))?new Date(file.createdTime).toLocaleString():'Date unavailable';
      comment.setAttribute('data-label','Comment');comment.textContent=file.description || '—';
      actions.setAttribute('data-label','Actions');actions.className='drive-file-actions';
      for(const [label,action] of [['Restore',()=>reviewRestoreBackup(file.id)],['Move to Trash',()=>{
        if(busy || !client.connected || getReviewDataset())return;
        backupTrashPlan={id:file.id,name:file.name,owner:connectedEmail,folderId:driveTree.backupsId,epoch};
        byId('googleDriveBackupTrashSummary').textContent=`Move “${file.name}” to Google Drive Trash? You can recover it from Drive Trash. Your current file is kept.`;
        update();byId('googleDriveBackupTrashHeading').focus();
      }]]){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',`${label}: ${file.name}`);
        button.disabled=busy || !client.connected || Boolean(getReviewDataset());button.addEventListener('click',action);actions.append(button);
      }
      row.append(name,date,comment,actions);body.append(row);
    }
  }
  async function refreshBackupList(operationEpoch){
    const tree=typeof client.findExistingBackupFolder==='function'?await client.findExistingBackupFolder():await client.getFolderTree();
    if(epoch!==operationEpoch)return;
    if(!tree){restoreFiles=new Map();backupListOwner=connectedEmail;backupListLoaded=true;cleanupPlan=undefined;restorePlan=undefined;backupTrashPlan=undefined;byId('googleDriveRestorePanel').hidden=true;byId('googleDriveBackupCleanup').hidden=true;return;}
    driveTree=tree;await reviewBackups(operationEpoch);
  }
  byId('restoreGoogleDriveBackupButton').addEventListener('click',()=>operation(async operationEpoch=>{
    await refreshBackupList(operationEpoch);if(epoch!==operationEpoch)return;
    status.textContent='Backup list refreshed.';byId('googleDriveBackupsHeading').focus();
  },'Loading your dated backups…','backups'));
  byId('cancelGoogleDriveBackupTrashButton').addEventListener('click',()=>{backupTrashPlan=undefined;update();byId('googleDriveBackupsHeading').focus();});
  byId('confirmGoogleDriveBackupTrashButton').addEventListener('click',()=>{
    const plan=backupTrashPlan;if(!plan || busy || plan.epoch!==epoch || plan.owner!==connectedEmail || getReviewDataset())return;
    operation(async operationEpoch=>{
      await client.trashBackup(plan.id,plan.folderId,plan.owner);if(epoch!==operationEpoch)return;
      restoreFiles.delete(plan.id);backupTrashPlan=undefined;
      if(restorePlan?.id===plan.id){restorePlan=undefined;byId('googleDriveRestorePanel').hidden=true;}
      await refreshBackupList(operationEpoch);if(epoch!==operationEpoch)return;
      status.textContent=`“${plan.name}” moved to Google Drive Trash. Your current file is kept.`;byId('googleDriveBackupsHeading').focus();
    },'Moving the confirmed backup to Trash…','backups');
  });
  byId('cancelGoogleDriveRestoreButton').addEventListener('click',()=>{restorePlan=undefined;byId('googleDriveRestorePanel').hidden=true;byId('restoreGoogleDriveBackupButton').focus();update();});
  function reviewRestoreBackup(id){
    if(busy || !client.connected || getReviewDataset())return;
    pauseSync('Automatic sync is paused while you review a backup.');
    byId('googleDriveRestorePanel').hidden=false;byId('googleDriveRestoreSummary').textContent='';
    return operation(async operationEpoch=>{
    restorePlan=undefined;requireRestoreReady();
    const file=restoreFiles.get(id);
    if(!file)throw new Error('Choose one of your listed backups.');
    const local=getBackupSnapshot(),before=await client.getUpdateState(id),source=await client.readBackup(id),after=await client.getUpdateState(id);
    if(epoch!==operationEpoch)return;
    if(before.etag!==after.etag || !after.owners?.some(owner=>owner.emailAddress===connectedEmail))throw new Error('The backup changed or is not owned by this Google account. Choose it again.');
    const parsed=getBackupEntriesFromText(source.text);if(parsed.skipped)throw new Error('This backup contains invalid records and cannot be restored.');
    const copies=await prepareSyncSchemas(undefined,local,source.backup);
    if(epoch!==operationEpoch)return;
    const hasSettings=copies.remote.settings!==undefined;
    if(hasSettings && (!copies.remote.settings || typeof copies.remote.settings!=='object' || Array.isArray(copies.remote.settings)))throw new Error('This backup has invalid capture settings and cannot be restored.');
    if(!hasSettings)copies.remote.settings=local.settings;
    restorePlan={epoch,owner:connectedEmail,id,etag:after.etag,local,snapshot:copies.remote,name:file.name};
    byId('googleDriveRestoreSummary').textContent=`${file.name}: ${copies.remote.entries.length} records, ratings out of ${copies.remote.ratingScale}. ${hasSettings?'Saved capture settings will be restored.':'This older backup has no capture settings; your existing settings will be kept.'} Restore this complete backup? Your current data will be replaced after recovery backups are saved.`;
    status.textContent='Review the backup details, then choose Restore this backup or Cancel.';
    byId('googleDriveRestoreHeading').focus();
  },'Reading and checking the backup…','restore');
  }
  byId('confirmGoogleDriveRestoreButton').addEventListener('click',()=>{
    const plan=restorePlan;if(!plan || busy || plan.epoch!==epoch || plan.owner!==connectedEmail)return;
    operation(async operationEpoch=>{
      requireRestoreReady();if(!sameRestoreLocal(plan))throw new Error('Local data changed. Review the backup again before restoring.');
      pauseSync('Automatic sync is paused for restoration.');
      const sourceState=await client.getUpdateState(plan.id);
      if(sourceState.etag!==plan.etag || !sourceState.owners?.some(owner=>owner.emailAddress===plan.owner))throw new Error('The backup changed. Review it again.');
      const current=await client.findCurrent(driveTree.folderId);
      let currentState,remote;
      if(current){
        currentState=await client.getUpdateState(current.id);remote=await client.readBackup(current.id);
        if(!currentState.editable || !currentState.owners?.some(owner=>owner.emailAddress===plan.owner))throw new Error('Your current file cannot be updated by this account.');
      }
      if(epoch!==operationEpoch)return;
      localStorage.setItem(`${syncStorageKey}RestoreRecovery`,JSON.stringify({local:plan.local,remote:remote?.backup,savedAt:new Date().toISOString()}));
      const date=new Date().toISOString().replace(/:/g,'-');
      for(const [name,copy] of [['device',plan.local],['Drive',remote?.backup]])if(copy){
        await client.createBackup(copy,{name:`${date} - Before restore ${name}.json`,parentId:driveTree.backupsId,role:'backup'});
        if(epoch!==operationEpoch)return;
      }
      requireRestoreReady();if(!sameRestoreLocal(plan))throw new Error('Local data changed during backup. Review again; recovery copies were saved.');
      const latestSource=await client.getUpdateState(plan.id);
      if(epoch!==operationEpoch)return;
      if(latestSource.etag!==plan.etag || !latestSource.owners?.some(owner=>owner.emailAddress===plan.owner))throw new Error('The selected backup changed during recovery. Review it again.');
      if(current){const latest=await client.getUpdateState(current.id);if(epoch!==operationEpoch)return;if(latest.etag!==currentState.etag || !latest.editable || !latest.owners?.some(owner=>owner.emailAddress===plan.owner))throw new Error('Your current Drive file changed during backup. Review again; nothing was replaced.');}
      requireRestoreReady();if(!sameRestoreLocal(plan))throw new Error('Local data changed during the final check. Review again; recovery copies were saved.');
      const restored=JSON.parse(JSON.stringify(plan.snapshot));
      const keep=new Set(restored.entries.map(entry=>entry.id));
      const deleted=new Set([...(remote?.backup.driveSync?.deletedIds||[]),...(rememberedBaseline(current?.id)?.driveSync?.deletedIds||[])]);
      for(const entry of [...plan.local.entries,...(remote?.backup.entries||[])])if(!keep.has(entry.id))deleted.add(entry.id);
      for(const id of keep)deleted.delete(id);
      restored.driveSync={version:1,deletedIds:[...deleted].sort(),restoreRevision:`${Date.now()}-${Math.random().toString(36).slice(2)}`};
      restored.exportedAt=new Date().toISOString();
      let result=current;
      if(current)await client.updateBackup(current.id,restored,currentState.etag);
      else {
        if(await client.findCurrent(driveTree.folderId))throw new Error('A current file appeared on another device. Review again before restoring.');
        if(epoch!==operationEpoch)return;
        result=await client.createBackup(restored,{name:'Emotion Wheel current.json',parentId:driveTree.folderId,role:'current'});
        const unique=await client.findCurrent(driveTree.folderId);if(!unique || unique.id!==result.id)throw new Error('More than one current file was found. Recovery copies were saved; review the folder before continuing.');
      }
      if(epoch!==operationEpoch)return;
      applyDriveSyncSnapshot(restored,plan.local);
      lastSyncedAt=new Date().toISOString();syncError='';syncFailedAt='';savedFileId=result.id;savedRecordCount=restored.entries.length;
      localStorage.setItem(syncStorageKey,JSON.stringify({id:result.id,owner:plan.owner,base:restored,lastSyncedAt}));
      restorePlan=undefined;clearPreview();clearSharingLink();
      await refreshBackupList(operationEpoch);if(epoch!==operationEpoch)return;
      status.textContent=`Restored ${restored.entries.length} records from ${plan.name}. Recovery backups were saved. Automatic sync is off; choose Start Sync when ready.`;
    },'Saving recovery copies, then restoring your backup…','restore');
  });
  byId('useLocalDataForDriveButton').addEventListener('click',()=>{if(busy)return;chooseLocal();selectAppView(maintenanceTab,false);byId('googleDriveLastSyncStatus').focus();});
  save.addEventListener('click',()=>{if(getReviewDataset()){feedbackArea='sync';status.textContent='Switch to My local data before saving or starting sync.';update();return;}if(syncTarget){runSync();return;}operation(async operationEpoch=>{
    const result = await saveCurrent(operationEpoch);
    if (!result || epoch !== operationEpoch) return;
    status.textContent = `Current file saved with ${result.snapshot.entries.length} records in Emotion Wheel. Its sharing link stays the same.`;
    await reviewBackups(operationEpoch);
  },'Checking both copies and saving to Drive…','sync');});
  byId('createGoogleDriveBackupButton').addEventListener('click',()=>operation(async operationEpoch=>{
    const name = byId('googleDriveBackupName').value.trim().replace(/\.json$/i,'');
    if (!name || name.length > 80 || /[\\/\x00-\x1f]/.test(name)) throw new Error('Enter a backup name without slashes, up to 80 characters.');
    const comment=byId('googleDriveBackupComment').value.trim();
    if(comment.length>80 || /[\x00-\x1f]/.test(comment))throw new Error('Enter a short backup comment of up to 80 characters.');
    const limit = Number(byId('googleDriveBackupLimit').value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose a backup limit between 1 and 100.');
    const result = await saveCurrent(operationEpoch);
    if (!result || epoch !== operationEpoch) return;
    const date = new Date().toISOString().replace(/:/g,'-');
    await client.createBackup({...result.snapshot,exportedAt:new Date().toISOString()},{name:`${date} - ${name}${comment?' - '+comment.replace(/[\\/]/g,'-'):''}.json`,description:comment,parentId:driveTree.backupsId,role:'backup'});
    if (epoch !== operationEpoch) return;
    byId('googleDriveBackupComment').value='';
    status.textContent = 'Dated backup saved in Emotion Wheel / Backups. Your current file is also up to date.';
    await reviewBackups(operationEpoch);
  },'Saving current data and a dated backup…'));
  byId('cancelGoogleDriveCleanupButton').addEventListener('click',()=>{cleanupPlan=undefined;byId('googleDriveBackupCleanup').hidden=true;status.textContent='All backups kept.';update();});
  byId('googleDriveBackupLimit').addEventListener('input',()=>{cleanupPlan=undefined;byId('googleDriveBackupCleanup').hidden=true;update();});
  byId('confirmGoogleDriveCleanupButton').addEventListener('click',()=>{
    const plan=cleanupPlan;
    if (!plan || plan.epoch!==epoch || plan.owner!==connectedEmail) return;
    operation(async operationEpoch=>{
      for (const file of [...plan.files]) {
        if (epoch!==operationEpoch || cleanupPlan!==plan) return;
        await client.trashBackup(file.id,plan.folderId,plan.owner);
        plan.files = plan.files.filter(remaining=>remaining.id !== file.id);
        byId('googleDriveCleanupList').replaceChildren();
        plan.files.forEach(remaining=>{const item=document.createElement('li');item.textContent=remaining.name;byId('googleDriveCleanupList').append(item);});
      }
      if (epoch!==operationEpoch) return;
      cleanupPlan=undefined; byId('googleDriveBackupCleanup').hidden=true;
      await refreshBackupList(operationEpoch);if(epoch!==operationEpoch)return;
      status.textContent='The reviewed oldest backups were moved to Google Drive Trash. Your current file and newest backups are kept.';
    },'Moving the reviewed oldest backups to Trash…','backups');
  });
  open.addEventListener('click', () => operation(async operationEpoch => {
    if (!client.connected) throw new Error('Reconnect Google Drive to open a backup.');
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve, reject) => gapi.load('picker', { callback: resolve,
      onerror: () => reject(new Error('The Google file picker could not load.')),
      timeout: 20000, ontimeout: () => reject(new Error('The Google file picker timed out.')) }));
    if (epoch !== operationEpoch) return;
    await new Promise((resolve, reject) => {
      const forSharing = pickingShareFile; pickingShareFile = false;
      const approvalFileId=!forSharing && linkedFileId ? EmotionWheelDrive.validFileId(linkedFileId) : '';
      const view = new google.picker.DocsView().setMimeTypes('application/json,text/plain').setMode(google.picker.DocsViewMode.LIST);
      if(approvalFileId)view.setFileIds(approvalFileId);
      let selected = false;
      finishPicker = resolve;
      const picker = new google.picker.PickerBuilder().setDeveloperKey(config.apiKey)
        .setAppId(config.appId).setOAuthToken(client.getPickerToken()).addView(view)
        .setOrigin(location.origin)
        .setTitle(approvalFileId?'Allow Emotion Wheel to open this shared file':'Select a Drive file')
        .setCallback(async data => {
          if (epoch !== operationEpoch) { resolve(); return; }
          if (selected) return;
          if (data.action === google.picker.Action.CANCEL) {
            selected = true; closePicker(); status.textContent = 'No Drive backup opened. Your personal log is kept.'; return;
          }
          if (data.action !== google.picker.Action.PICKED) return;
          selected = true;
          // Hide the picker without resolving until the selected file is validated.
          activePicker?.setVisible(false); activePicker = undefined;
          try {
            const fileId = EmotionWheelDrive.validFileId(data.docs[0].id);
            if (!forSharing && linkedFileId && fileId !== linkedFileId) throw new Error('Choose the backup referenced by this sharing link.');
            if (forSharing) {
              const result = await client.readBackup(fileId);
              if (epoch !== operationEpoch) { resolve(); return; }
              if (!result.metadata.owners?.some(owner=>owner.emailAddress===connectedEmail) || result.metadata.capabilities?.canShare !== true) throw new Error('Choose a file you own and can share. Files shared with you cannot be shared from here.');
              const parsed = getBackupEntriesFromText(result.text);
              if (parsed.skipped) throw new Error('This file contains invalid records. Review it before sharing.');
              showSharing(fileId,result.metadata.name || 'Selected backup',parsed.validEntries.length,fileId===savedFileId);
              try {await loadSharingAccess(fileId,operationEpoch);} catch(error) {if(epoch===operationEpoch)byId('googleDriveAccessMessage').textContent=error.message;}
            } else await openPreview(fileId, operationEpoch, Boolean(linkedFileId));
            resolve();
          } catch (error) { reject(error); }
          finally { if (epoch === operationEpoch) finishPicker = undefined; }
        }).build();
      activePicker = picker;
      update();
      picker.setVisible(true);
    });
  }, 'Choose a JSON backup in Google Drive…',pickingShareFile?'share':'files'));
  refresh.addEventListener('click', () => operation(operationEpoch => openPreview(previewFileId, operationEpoch, !['maintenance','shared'].includes(currentAppView)), 'Refreshing the shared backup…','files'));
  byId('closeGoogleDrivePreviewButton').addEventListener('click', chooseLocal);
  disconnect.addEventListener('click', () => {
    clearTimeout(sharedListTimer);byId('googleDriveSharedListSyncStatus').textContent='Google is disconnected. Your shared-file list is kept in this browser; connect to check changes on other devices.';pendingSafetyBackup=undefined;epoch++; driveTree = undefined; cleanupPlan = undefined; byId('googleDriveBackupCleanup').hidden = true; pauseSync(); client.disconnect(); clearTimeout(accountExpiryTimer); connectedEmail = ''; resetSharing(); busy = false; savedFileId = ''; clearPreview(); savedPanel.hidden = true;
    closePicker();
    connect.textContent = 'Connect Google Drive';
    status.textContent = 'Google Drive disconnected. Local records and Drive files are kept.'; update(); connect.focus();
  });
  async function loadSharingAccess(fileId, operationEpoch) {
    const owner=connectedEmail;
    if (!fileId) {
      const current=await client.findExistingCurrent();
      if (epoch!==operationEpoch) return;
      fileId=current?.id;
    }
    if (!fileId) {
      accessFileId='';accessOwner=owner;accessPeopleCount=0;shareResultFileId='';stopSharingPlan=undefined;
      byId('googleDriveAccessBody').replaceChildren();byId('googleDriveAccessTable').hidden=true;byId('googleDriveSharingResult').hidden=true;
      const message='No current Drive file is available to this app yet. Save to Drive in My Data, or choose Add person to prepare a file for sharing.';
      byId('googleDriveAccessMessage').textContent=message;status.textContent=message;return;
    }
    accessPeopleCount=0;byId('googleDriveAccessBody').replaceChildren();byId('googleDriveAccessTable').hidden=true;
    const result=await client.getSharing(fileId,owner);
    if (epoch!==operationEpoch || owner!==connectedEmail || !client.connected) return;
    accessFileId=fileId; accessOwner=owner; stopSharingPlan=undefined;
    const body=byId('googleDriveAccessBody');body.replaceChildren();
    const permissions=result.permissions.filter(permission=>permission.role!=='owner' && permission.type==='user');
    accessPeopleCount=permissions.length;shareResultFileId=fileId;
    byId('googleDriveShareLink').value=EmotionWheelDrive.sharingUrl(location.href,fileId);
    byId('googleDriveShareLinkMessage').textContent=accessPeopleCount ? 'Send this link to someone listed above. They need to connect the Google account that has access.' : 'Add a person above before sending this link. Copy link and Share link become available after you give someone access.';
    byId('googleDriveSharingResult').hidden=false;
    for (const permission of permissions) {
      const label=permission.type==='anyone'?'Anyone with the link':permission.type==='domain'?`Everyone at ${permission.domain || 'this domain'}`:permission.emailAddress || permission.displayName || 'Google account';
      const row=document.createElement('tr'), person=document.createElement('td'), role=document.createElement('td'), actions=document.createElement('td');
      person.textContent=permission.type==='group'?`${label} (group)`:label;
      role.textContent=({reader:'Viewer',commenter:'Commenter',writer:'Editor'})[permission.role] || permission.role;
      if(permission.id && permission.type==='user') {
        const remove=document.createElement('button');remove.type='button';remove.textContent='Stop sharing';remove.setAttribute('aria-label',`Stop sharing with ${label}`);
        remove.addEventListener('click',()=>{
          if(busy || !client.connected || accessOwner!==connectedEmail)return;
          stopSharingPlan={fileId,permissionId:permission.id,owner,epoch,label};
          byId('googleDriveStopSharingMessage').textContent=`Remove ${label}’s ${role.textContent.toLowerCase()} access to ${result.file.name || 'this file'}? Other group or public permissions may still give them access. Copies they already downloaded are kept.`;
          update();byId('googleDriveStopSharingHeading').focus();
        }); actions.append(remove);
      }
      row.append(person,role,actions);body.append(row);
    }
    byId('googleDriveAccessTable').hidden=permissions.length===0;
    status.textContent='Sharing list refreshed from Google Drive.';
    byId('googleDriveAccessMessage').textContent=`${result.file.name || 'Drive file'}: ${permissions.length ? 'people list refreshed from Google Drive.' : 'no people have been given access. Add a person to enable the sharing link.'}`;
  }
  function refreshSharingAccess() {
    if(!client.connected || !connectedEmail || busy)return;
    return operation(operationEpoch=>loadSharingAccess(sharingFileId || shareResultFileId || savedFileId || accessFileId,operationEpoch),'Checking who has access…','share');
  }
  byId('refreshGoogleDriveSharingButton').addEventListener('click',refreshSharingAccess);
  byId('sharingConnectGoogleButton').addEventListener('click',()=>connect.click());
  byId('shareMyDataMenuButton').addEventListener('click',()=>{
    selectAppView(shareMyDataTab,false);byId('shareMyDataHeading').focus();refreshSharingAccess();
  });
  byId('cancelGoogleDriveStopSharingButton').addEventListener('click',()=>{stopSharingPlan=undefined;update();byId('refreshGoogleDriveSharingButton').focus();});
  byId('confirmGoogleDriveStopSharingButton').addEventListener('click',()=>{
    const plan=stopSharingPlan;
    if(!plan || plan.epoch!==epoch || plan.owner!==connectedEmail || busy)return;
    operation(async operationEpoch=>{
      await client.stopSharing(plan.fileId,plan.permissionId,plan.owner);
      if(epoch!==operationEpoch)return;
      stopSharingPlan=undefined;
      status.textContent=`Access removed for ${plan.label}.`;
      try {await loadSharingAccess(plan.fileId,operationEpoch);} catch(error) {if(epoch===operationEpoch)status.textContent+=` Refresh the list to check remaining access. ${error.message}`;}
    },'Removing the confirmed access…','share');
  });
  function resetSharing() {
    pickingShareFile = false;
    sharingFileId = '';
    shareResultFileId = accessFileId; byId('googleDriveSharingResult').hidden = !accessFileId;
    byId('googleDriveSharingForm').hidden = true;
    byId('googleDriveRecipientEmail').value = '';
    byId('googleDriveNotifyRecipient').checked = false;
  }
  function showSharing(id, name, count, isCurrent) {
    feedbackArea='share'; resetSharing(); sharingFileId=id; sharingIsCurrent=isCurrent;
    byId('googleDriveSharingSelectedFile').textContent = isCurrent
      ? `Your current file: ${name}. This link stays up to date when you save or sync.`
      : `Selected backup: ${name}. This is a separate copy.`;
    byId('googleDriveShareOptions').open=false;
    status.textContent='Enter their Google email to give them read-only access.';
    byId('googleDriveSharingForm').hidden=false; update(); byId('googleDriveRecipientEmail').focus();
  }
  byId('shareGoogleDriveCopyButton').addEventListener('click', async () => {
    if (!client.connected || !connectedEmail || busy) return;
    const shareEpoch=epoch;
    if (!savedFileId) {
      let remembered;
      try { remembered=JSON.parse(localStorage.getItem(syncStorageKey)||'null'); } catch {}
      if (remembered?.owner===connectedEmail && remembered.id) {
        const existing = await operation(async operationEpoch=>{
          const remote=await client.readBackup(EmotionWheelDrive.validFileId(remembered.id));
          if (epoch!==operationEpoch) return;
          if (!remote.metadata.owners?.some(owner=>owner.emailAddress===connectedEmail) || remote.metadata.appProperties?.role!=='current') return;
          const parsed=getBackupEntriesFromText(remote.text);
          if (parsed.skipped) throw new Error('Review invalid records before sharing this file.');
          return {id:remembered.id,count:parsed.validEntries.length};
        },'Opening your current file…','share');
        if (epoch!==shareEpoch || !client.connected) return;
        if (existing) { savedFileId=existing.id;savedRecordCount=existing.count; }
      }
    }
    if (!savedFileId) {
      const prepared = await operation(operationEpoch=>saveCurrent(operationEpoch),'Preparing your current file to share…','share');
      if (!prepared || epoch!==shareEpoch || !client.connected) return;
    }
    showSharing(savedFileId,'Emotion Wheel current.json',savedRecordCount,true);
    await refreshSharingAccess();
  });
  byId('chooseGoogleDriveSharingFileButton').addEventListener('click',()=>{
    if (!client.connected || !connectedEmail || busy) return;
    pickingShareFile=true; open.click();
  });
  byId('cancelGoogleDriveSharingButton').addEventListener('click', () => {
    resetSharing(); update(); byId('shareGoogleDriveCopyButton').focus();
  });
  byId('giveGoogleDriveAccessButton').addEventListener('click', () => {
    const input=byId('googleDriveRecipientEmail'); input.value=input.value.trim();
    if (!sharingFileId || !client.connected || busy || !input.reportValidity()) return;
    const approval={fileId:sharingFileId,email:input.value,notify:byId('googleDriveNotifyRecipient').checked,isCurrent:sharingIsCurrent};
    operation(async operationEpoch => {
      const permission = await client.shareWithViewer(approval.fileId, approval.email, approval.notify);
      if (epoch !== operationEpoch) return;
      resetSharing();
      shareResultFileId = approval.fileId;
      byId('googleDriveShareLink').value = EmotionWheelDrive.sharingUrl(location.href,approval.fileId);
      byId('googleDriveShareLinkMessage').textContent = `Viewer access is ready for ${permission.emailAddress || approval.email}. Send them this link to open the file in Emotion Wheel.`;
      byId('googleDriveSharingResult').hidden = false;
      byId('googleDriveShareLinkHeading').focus();
      try {await loadSharingAccess(approval.fileId,operationEpoch);} catch(error) {if(epoch===operationEpoch)byId('googleDriveAccessMessage').textContent=`Access was granted. Refresh the list to see who has access. ${error.message}`;}
      if(epoch!==operationEpoch)return;
      status.textContent = `Viewer access granted to ${permission.emailAddress || approval.email}. Copy the ${approval.fileId === savedFileId ? 'saved copy’s' : 'selected dataset’s'} Emotion Wheel link and send it to them. ${approval.isCurrent ? 'They can see updates when you save or sync this current file.' : 'This link opens the selected backup, which is separate from your synced file.'}`;
    }, 'Granting the confirmed recipient Viewer access…','share');
  });
  byId('closeGoogleDriveSharingResultButton').addEventListener('click',()=>{resetSharing();update();byId('shareGoogleDriveCopyButton').focus();});
  byId('copyGoogleDriveResultLinkButton').addEventListener('click',()=>{if(accessPeopleCount && client.connected && !busy)copyLink(shareResultFileId);});
  byId('shareGoogleDriveLinkButton').addEventListener('click',async()=>{
    if (!shareResultFileId || !accessPeopleCount || !client.connected || busy) return;
    const url=EmotionWheelDrive.sharingUrl(location.href,shareResultFileId);
    if (!navigator.share) { const copied=await copyLink(shareResultFileId); byId('googleDriveShareSheetStatus').textContent=copied?'This browser does not offer a share sheet. The link has been copied.':'This browser does not offer a share sheet. Copy the link above instead.';return; }
    try { await navigator.share({title:'Emotion Wheel shared data',url}); byId('googleDriveShareSheetStatus').textContent='Sharing finished.'; }
    catch(error) { byId('googleDriveShareSheetStatus').textContent=error.name==='AbortError'?'Sharing cancelled. The link is still available above.':'The share sheet could not open. Copy the link above instead.'; }
  });
  byId('googleDriveLinkSignInButton').addEventListener('click',()=>{
    if (client.connected && !linkAccessProblem) operation(operationEpoch=>openPreview(linkedFileId,operationEpoch),'Checking your access to the shared file…');
    else connect.click();
  });
  byId('googleDriveLinkCancelButton').addEventListener('click',()=>{chooseLocal();selectAppView(logsTab,true);});
  window.addEventListener('hashchange',()=>{receiveSharingLink();if(linkedFileId || invalidSharingLink)selectAppView(sharedDataTab,true);update();if(linkedFileId)prepareGoogle().catch(error=>{status.textContent=error.message;update();});});
  byId('googleDriveLinkPickerButton').addEventListener('click',()=>open.click());

  function pauseSync(message) {
    const hadTarget=Boolean(syncTarget);
    clearTimeout(syncTimer);syncRunning=false;syncWanted=false; syncTarget = undefined; clearSyncConflict();
    byId('googleDriveSyncStatus').textContent = message || (hadTarget?'Sync paused. Local records and the Drive file are kept.':'Automatic sync is off.');
    byId('googleDriveSyncStatus').hidden=!hadTarget && !message;
  }
  function scheduleSync(delay=15000,retryAttempt=0) {
    clearTimeout(syncTimer);
    if (!syncTarget) return;
    syncRunning=true;
    syncTimer = setTimeout(() => {
      if (busy) scheduleSync(delay,retryAttempt); else runSync(retryAttempt);
    }, delay);
    syncTimer?.unref?.();
  }
  function clearSyncConflict() {
    conflictReview=undefined;conflictChoice=undefined;
    byId('googleDriveConflict').hidden=true;
  }
  function recordSyncFailure(message) {
    syncError=message;syncFailedAt=new Date().toISOString();
    try {const remembered=JSON.parse(localStorage.getItem(syncStorageKey)||'null');if(remembered?.owner===connectedEmail)localStorage.setItem(syncStorageKey,JSON.stringify({...remembered,syncError,syncFailedAt}));}catch{}
  }
  function reviewSyncIssue(){
    selectAppView(maintenanceTab,false);
    if(syncError && !client.connected){byId('googleDriveSyncStatus').hidden=false;byId('googleDriveSyncStatus').textContent='Reconnect your Google account, then choose Save to Drive to review the latest copies.';}
    if(conflictReview)byId('googleDriveConflict').hidden=false;
    (conflictReview?byId('googleDriveConflictHeading'):syncError?byId('googleDriveSyncStatus'):byId('googleDriveLastSyncStatus')).focus();
  }
  byId('googleDriveSyncSummaryButton').addEventListener('click',reviewSyncIssue);
  byId('reviewGoogleDriveSyncIssueButton').addEventListener('click',reviewSyncIssue);
  function showSyncConflict(plan,error) {
    clearTimeout(syncTimer);syncRunning=false;conflictReview={...plan,epoch,automatic:syncWanted};conflictChoice={};
    if(syncWanted && !syncTarget)syncTarget={id:plan.id,owner:plan.owner,base:plan.base};
    byId('googleDriveConflict').hidden=false;
    let conflicts;try{conflicts=EmotionWheelSync.getConflicts(plan.base,plan.local,plan.remote);}catch{conflicts=[];}
    if(!conflicts.length){clearSyncConflict();recordSyncFailure(error.message);return;}
    const container=byId('googleDriveConflictRecords');container.replaceChildren();
    for(const item of conflicts) {
      const section=document.createElement('fieldset'),legend=document.createElement('legend');
      const example=item.local || item.remote;
      legend.textContent=item.key.startsWith('record ')?`Record: ${example?.timestamp || ''} ${example?.inner || ''}`:item.key==='dataset'?'A backup was restored or rating scales differ — choose one complete dataset':`Choose ${item.key}`;
      section.append(legend);
      for(const side of ['local','remote']) {
        const preview=document.createElement('pre');preview.className='sync-copy-preview';
        const value=item[side];
        const labels={timestamp:'Recorded',modifiedAt:'Updated',inner:'Emotion',middle:'Middle emotion',outer:'Outer emotion',comment:'Note',expectedIntensity:'Expected intensity',actualIntensity:'Actual intensity',physicalSensations:'Physical sensations',bucketLevel:'Emotion bucket level'};
        const readable=item.key.startsWith('record ') && value?Object.entries(value).filter(([key])=>!['id','createdAt','legacyIdentity'].includes(key)).map(([key,text])=>`${labels[key]||key.replace(/([A-Z])/g,' $1')}: ${typeof text==='object'?JSON.stringify(text):text}`).join('\n'):JSON.stringify(value,null,2);
        preview.textContent=`${side==='local'?'This device':'Google Drive'}\n${value===undefined?'Deleted':readable}`;
        const label=document.createElement('label'),radio=document.createElement('input');radio.type='radio';radio.name=`sync-choice-${item.key}`;radio.value=side;
        radio.addEventListener('change',()=>{conflictChoice[item.key]=side;});
        const text=document.createElement('span');text.textContent=`Keep ${side==='local'?'this device’s':'Google Drive’s'} version${item[side]===undefined?' (delete this record)':''}`;
        label.append(radio,text);section.append(preview,label);
      }
      container.append(section);
    }
    conflictReview.conflicts=conflicts;
    recordSyncFailure(error.message);
    byId('googleDriveSyncStatus').textContent='Sync paused because versions conflict. Choose which version to keep below.';
    byId('googleDriveConflictHeading').focus();
  }
  byId('cancelGoogleDriveConflictButton').addEventListener('click',()=>{clearTimeout(syncTimer);syncRunning=false;byId('googleDriveConflict').hidden=true;feedbackArea='connection';update();});
  byId('confirmGoogleDriveConflictButton').addEventListener('click',()=>{
    const plan=conflictReview,choices=conflictChoice && {...conflictChoice};
    if(!plan?.conflicts?.length || !choices || busy || plan.epoch!==epoch || plan.owner!==connectedEmail)return;
    if(plan.conflicts.some(item=>!choices[item.key])){byId('googleDriveSyncStatus').textContent='Choose a version for every conflict before applying.';return;}
    operation(async operationEpoch=>{
      if(!dataSchemaMatches() || (typeof editingEntry!=='undefined' && editingEntry) || (typeof pendingRatingScaleChange!=='undefined' && pendingRatingScaleChange))throw new Error('Finish the current edit or scale review before resolving sync.');
      // Export timestamps may change between snapshots; compare actual content and deletion markers.
      const sameLocal=()=>EmotionWheelSync.canonical(EmotionWheelSync.content(getBackupSnapshot()))===EmotionWheelSync.canonical(EmotionWheelSync.content(plan.local)) && EmotionWheelSync.canonical(getBackupSnapshot().driveSync)===EmotionWheelSync.canonical(plan.local.driveSync);
      if(!sameLocal())throw new Error('This device changed since the review. Use Sync Now to review the latest copies.');
      const before=await client.getUpdateState(plan.id);
      if(epoch!==operationEpoch)return;
      if(before.etag!==plan.etag || !before.editable || !before.owners?.some(owner=>owner.emailAddress===plan.owner))throw new Error('Drive changed since the review. Use Sync Now to review the latest copies.');
      localStorage.setItem(`${syncStorageKey}ConflictRecovery`,JSON.stringify({id:plan.id,owner:plan.owner,local:plan.local,remote:plan.remote,savedAt:new Date().toISOString()}));
      driveTree=await client.getFolderTree();if(epoch!==operationEpoch)return;
      const date=new Date().toISOString().replace(/:/g,'-');
      for(const copy of ['local','remote']) {
        await client.createBackup(plan[copy],{name:`${date} - Before conflict resolution ${copy==='local'?'device':'Drive'}.json`,parentId:driveTree.backupsId,role:'backup'});
        if(epoch!==operationEpoch || conflictReview!==plan)return;
      }
      const after=await client.getUpdateState(plan.id);if(epoch!==operationEpoch)return;
      if(after.etag!==plan.etag || !sameLocal())throw new Error('A copy changed during backup. Use Sync Now to review again; recovery copies were saved.');
      const chosen=EmotionWheelSync.reconcile(plan.base,plan.local,plan.remote,{choices});
      await client.updateBackup(plan.id,{...chosen,exportedAt:new Date().toISOString()},after.etag);
      if(epoch!==operationEpoch)return;
      applyDriveSyncSnapshot(chosen,plan.local);
      syncTarget=plan.automatic?{id:plan.id,owner:plan.owner,base:chosen}:undefined;syncWanted=plan.automatic;syncRunning=false;savedFileId=plan.id;savedRecordCount=chosen.entries.length;
      lastSyncedAt=new Date().toISOString();syncError='';syncFailedAt='';localStorage.setItem(syncStorageKey,JSON.stringify({id:plan.id,owner:plan.owner,base:chosen,lastSyncedAt}));
      clearSyncConflict();status.textContent=`Conflict resolved. Both original copies were saved as recovery backups. ${plan.automatic?'Automatic sync is running.':'Automatic sync stays off.'}`;
      byId('googleDriveSyncStatus').textContent=status.textContent;scheduleSync();await reviewBackups(operationEpoch);
    },'Saving recovery copies before resolving the conflict…','sync').then(()=>{feedbackArea='connection';update();});
  });
  async function runSync(retryAttempt=0) {
    if (!syncTarget || busy) return;
    const target = syncTarget;
    let success = false;
    let retryable = false;
    await operation(async operationEpoch => {
      try {
      if (!client.connected || connectedEmail !== target.owner) throw new Error('Reconnect the sync owner account.');
      if (!dataSchemaMatches()) throw new Error('Complete the local data upgrade before syncing.');
      if ((typeof editingEntry !== 'undefined' && editingEntry) || (typeof pendingRatingScaleChange !== 'undefined' && pendingRatingScaleChange)) throw new Error('Finish the current edit or scale review before syncing.');
      const local = getBackupSnapshot();
      const before = await client.getUpdateState(target.id);
      if (epoch !== operationEpoch || syncTarget !== target) return;
      if (!before.editable || !before.owners?.some(owner => owner.emailAddress === target.owner)) throw new Error('Only your own editable Drive file can sync.');
      const remote = await client.readBackup(target.id);
      const after = await client.getUpdateState(target.id);
      if (epoch !== operationEpoch || syncTarget !== target) return;
      if (before.etag !== after.etag) { const error=new Error('Drive changed while reading.');error.code='sync-copy-changed';throw error; }
      const parsed = getBackupEntriesFromText(remote.text);
      if (parsed.skipped) throw new Error('The Drive schema or records require review before sync.');
      const copies=await prepareSyncSchemas(target.base,local,remote.backup);
      if(epoch!==operationEpoch || syncTarget!==target)return;
      if(copies.upgraded && !await preserveSchemaCopies(local,remote.backup,operationEpoch))return;
      let merged;
      try { merged = EmotionWheelSync.reconcile(copies.base, copies.local, copies.remote); }
      catch(error) { if(error.code==='sync-conflict') showSyncConflict({id:target.id,owner:target.owner,base:copies.base,local,remote:copies.remote,etag:after.etag},error); throw error; }
      const localNow = getBackupSnapshot();
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(localNow)) !== EmotionWheelSync.canonical(EmotionWheelSync.content(local))) { const error=new Error('Local data changed during sync.');error.code='sync-copy-changed';throw error; }
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(merged)) !== EmotionWheelSync.canonical(EmotionWheelSync.content(remote.backup)) ||
          EmotionWheelSync.canonical(merged.driveSync) !== EmotionWheelSync.canonical(remote.backup.driveSync)) {
        await client.updateBackup(target.id, { ...merged, exportedAt: new Date().toISOString() }, after.etag);
      }
      if (epoch !== operationEpoch || syncTarget !== target) return;
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(merged)) !== EmotionWheelSync.canonical(EmotionWheelSync.content(getBackupSnapshot()))) {
        applyDriveSyncSnapshot(merged, local);
      }
      target.base = merged;
      lastSyncedAt=new Date().toISOString();syncError='';syncFailedAt='';
      localStorage.setItem(syncStorageKey, JSON.stringify({ id: target.id, owner: target.owner, base: merged,lastSyncedAt }));
      clearSyncConflict();
      byId('googleDriveSyncStatus').textContent = `${merged.entries.length} records checked successfully.`;
      status.textContent = byId('googleDriveSyncStatus').textContent;
      success = true;
      } catch(error) {
        retryable=['sync-copy-changed','drive-conflict','drive-network'].includes(error.code);
        throw error;
      }
    }, 'Checking both copies for changes…','sync');
    if (syncTarget !== target) return;
    if (!success) {
      if(retryable && retryAttempt<3 && syncWanted && client.connected && !conflictReview) {
        byId('googleDriveSyncStatus').textContent=`${status.textContent} Automatic sync will retry in 15 seconds using the latest copies (retry ${retryAttempt+1} of 3).`;
        status.textContent=byId('googleDriveSyncStatus').textContent;
        scheduleSync(15000,retryAttempt+1);
        feedbackArea='connection';update();return;
      }
      clearTimeout(syncTimer);syncRunning=false;
      byId('googleDriveSyncStatus').textContent = `Sync paused. ${status.textContent} Use Sync now after reviewing both copies. No automatic retry will overwrite a conflict.`;
    } else scheduleSync();
    feedbackArea='connection'; update();
  }
  byId('testGoogleDriveSyncGuardButton').addEventListener('click', () => operation(async operationEpoch => {
    const selected = getReviewDataset();
    if (location.hostname !== 'localhost' || selected?.fileId !== '1mJnWuoX58_YY9lzg5jm5t9Kdm1azZpD9' || selected.owner !== connectedEmail) throw new Error('This check is limited to the approved synthetic backup.');
    pauseSync();
    const remote = await client.readBackup(selected.fileId);
    if (epoch !== operationEpoch) return;
    const baseline = await client.getUpdateState(selected.fileId);
    if (epoch !== operationEpoch) return;
    const stale = baseline.etag.replace(/[A-Za-z0-9](?=[^A-Za-z0-9]*"$)/, character => /[0-9]/.test(character) ? (character === '0' ? '1' : '0') : (character === 'a' ? 'b' : 'a'));
    if (stale === baseline.etag) throw new Error('Unable to construct a safe stale-update test.');
    try {
      await client.updateBackup(selected.fileId, remote.backup, stale);
    } catch (error) {
      if (error.code === 'drive-conflict') {
        syncSafetyVerified = true;
        byId('googleDriveSyncStatus').textContent = 'Live conflict protection passed: Google rejected the stale update. The backup was not overwritten.';
        return;
      }
      throw error;
    }
    throw new Error('Google accepted a stale update. Do not enable sync until conditional updates are fixed.');
  }, 'Testing stale-update rejection on the approved synthetic backup…'));
  async function offerExistingSync() {
    if(!client.connected || !connectedEmail || busy || getReviewDataset() || syncTarget || typeof client.findExistingCurrent!=='function')return;
    await operation(async operationEpoch=>{
      const owner=connectedEmail;
      const current=await client.findExistingCurrent();
      if(epoch!==operationEpoch || owner!==connectedEmail || !client.connected || getReviewDataset())return;
      if(current?.id && current.owners?.some(item=>item.emailAddress===owner)) {
        syncOffer={epoch:operationEpoch,owner,id:current.id};
        byId('googleDriveSyncOfferMessage').textContent=`Found ${current.name || 'your current Emotion Wheel file'} in ${owner}’s Google Drive. Would you like to start automatic sync?`;
        status.textContent='Your current Drive file was found. Choose Start syncing or Not now.';
        update();byId('googleDriveSyncOfferHeading').focus();
      } else status.textContent='Google Drive connected. No existing current file was found. You can save your local data or start sync in My Data.';
    },'Checking for your current sync file…','connection');
  }
  byId('declineGoogleDriveSyncOfferButton').addEventListener('click',()=>{syncOffer=undefined;update();byId('googleDriveSyncSummaryButton').focus();});
  byId('acceptGoogleDriveSyncOfferButton').addEventListener('click',()=>{
    if(!syncOffer || syncOffer.epoch!==epoch || syncOffer.owner!==connectedEmail || !client.connected || busy || getReviewDataset())return;
    syncOffer=undefined;update();byId('startGoogleDriveSyncButton').click();selectAppView(maintenanceTab,false);byId('googleDriveLastSyncStatus').focus();
  });
  byId('startGoogleDriveSyncButton').addEventListener('click', async () => {
    if(syncTarget){if(!busy){pauseSync();feedbackArea='connection';update();}return;}
    if (!syncSafetyVerified || !connectedEmail || !client.connected || busy) return;
    if(getReviewDataset()){feedbackArea='sync';status.textContent='Switch to My local data before starting sync.';update();return;}
    syncWanted=true;
    const prepared = await operation(operationEpoch => saveCurrent(operationEpoch), 'Preparing your current Drive file…','sync');
    if (!prepared || !savedFileId || !client.connected || busy) {if(!conflictReview)syncWanted=false;return;}
    syncTarget = {id:prepared.current.id,owner:connectedEmail,base:prepared.snapshot};
    runSync(); update();
  });

  if(linkedFileId || invalidSharingLink)selectAppView(sharedDataTab,true);
  if(location.hash==='#sync-issue')reviewSyncIssue();
  update();
  if (linkedFileId || ['maintenance','shared'].includes(currentAppView)) prepareGoogle().catch(error=>{status.textContent=error.message;update();});
})();
