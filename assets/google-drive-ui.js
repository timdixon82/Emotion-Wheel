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
  let driveTree, cleanupPlan, shareResultFileId = '', linkAccessProblem = false;
  let busy = false, epoch = 0, savedFileId = '', previewFileId = '', linkedFileId = '';
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('drive')) {
    try { linkedFileId = EmotionWheelDrive.validFileId(fragment.get('drive')); }
    catch { status.textContent = 'This Drive sharing link is invalid.'; }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    selectAppView(maintenanceTab, true);
    if (linkedFileId) status.textContent = 'Connect Google Drive to open this shared backup. Your personal log will be kept.';
  }

  function persistBookmarks() {
    try {
      localStorage.setItem(datasetStorageKey, JSON.stringify([...bookmarks].map(([id, label]) => ({ id, label }))));
    } catch { status.textContent += ' Dataset names could not be remembered in this browser.'; }
  }
  function setDataset(dataset) {
    changingReview = true;
    try { setReviewDataset(dataset); } finally { changingReview = false; }
  }
  let syncTarget, syncTimer, syncSafetyVerified = true; // Live stale-ETag rejection verified on the synthetic file.
  const syncStorageKey = 'emotionWheelDriveSyncV1';
  function update() {
    if (cleanupPlan && cleanupPlan.epoch !== epoch) { cleanupPlan=undefined; byId('googleDriveBackupCleanup').hidden=true; }
    connect.disabled = busy || preparingGoogle;
    byId('googleDriveLinkPrompt').hidden = !linkedFileId;
    byId('googleDriveLinkSignInButton').disabled = busy || preparingGoogle;
    byId('googleDriveLinkSignInButton').textContent = client.connected ? (linkAccessProblem ? 'Switch Google account' : 'Try opening again') : 'Connect Google Drive';
    byId('googleDriveLinkPickerButton').hidden = !linkedFileId || !client.connected || !linkAccessProblem;
    byId('googleDriveLinkPickerButton').disabled = busy;
    byId('googleDriveLinkAccessPage').hidden = !linkedFileId || !linkAccessProblem;
    if (linkedFileId) byId('googleDriveLinkAccessPage').href = `https://drive.google.com/file/d/${linkedFileId}/view`;
    byId('googleDriveLinkMessage').textContent = linkAccessProblem
      ? 'This account cannot open the file. If the owner already gave you access, choose the shared file below to let Emotion Wheel open it. Otherwise ask the owner for Viewer access, or open Google Drive to request it.'
      : client.connected ? 'Checking access to the shared file. You can try again if loading fails.' : 'Sign in to Google so we can check your access to this file. Your own records will be kept.';

    save.disabled = byId('createGoogleDriveBackupButton').disabled = busy || !client.connected || !connectedEmail;
    open.disabled = refresh.disabled = busy || !client.connected;
    byId('confirmGoogleDriveCleanupButton').disabled = busy || !cleanupPlan || !client.connected;
    disconnect.disabled = !client.connected && !busy;
    disconnect.hidden = !client.connected && !busy;
    savedPanel.hidden = !client.connected || Boolean(sharingFileId || shareResultFileId);
    byId('shareGoogleDriveCopyButton').disabled = busy || !connectedEmail || !client.connected;
    byId('chooseGoogleDriveSharingFileButton').disabled = busy || !connectedEmail || !client.connected;
    byId('giveGoogleDriveAccessButton').disabled = busy || !sharingFileId || !client.connected;
    byId('cancelGoogleDriveSharingButton').disabled = busy;
    const accountText = client.connected ? (connectedEmail ? `Google Drive connected as ${connectedEmail}.` : 'Google Drive connected; account email is unavailable.') : 'Google Drive is disconnected.';
    byId('googleAccountStatus').textContent = byId('googleMaintenanceAccountStatus').textContent = accountText;
    byId('googleAccountStatus').hidden = !client.connected;
    const selected = getReviewDataset();
    datasetSelect.replaceChildren(new Option('My local data', 'local'));
    bookmarks.forEach((label, id) => datasetSelect.add(new Option(`${label} — ${id.slice(-6)}`, id)));
    if (selected && !bookmarks.has(selected.fileId)) datasetSelect.add(new Option(selected.label, selected.fileId));
    datasetSelect.value = selected?.fileId || 'local';
    renderFileTable();
    byId('startGoogleDriveSyncButton').hidden = Boolean(syncTarget);
    byId('startGoogleDriveSyncButton').disabled = !syncSafetyVerified || busy || !client.connected || !connectedEmail;
    byId('syncGoogleDriveNowButton').disabled = busy || !syncTarget || !client.connected;
    byId('pauseGoogleDriveSyncButton').disabled = !syncTarget;
    byId('syncGoogleDriveNowButton').hidden = byId('pauseGoogleDriveSyncButton').hidden = !syncTarget;
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
  async function operation(action, message) {
    if (busy) return;
    const operationEpoch = epoch;
    busy = true; status.textContent = message; update();
    try { return await action(operationEpoch); }
    catch (error) {
      if (epoch === operationEpoch) status.textContent = error instanceof SyntaxError ?
        'The Drive file or connection configuration is invalid. Your local records are kept.' :
        error.message || 'Google Drive is unavailable. Your local records are kept.';
      if (epoch === operationEpoch && error.code === 'drive-access' && linkedFileId && client.connected) {
        linkAccessProblem = true; selectAppView(maintenanceTab,true);
        status.textContent += ' If you have access in Drive, choose Add a Drive file and select this file to grant the app access.';
      }
    } finally {
      if (epoch === operationEpoch) { busy = false; update(); }
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
    linkedFileId = ''; linkAccessProblem = false;
    if (navigate && !['logs', 'charts'].includes(currentAppView)) selectAppView(logsTab, true);
    status.textContent = `Shared dataset refreshed from Drive at ${new Date().toLocaleTimeString()}. Your local records and settings are kept.`;
  }
  function chooseLocal() {
    epoch++; busy = false; resetSharing(); closePicker(); clearPreview(); linkedFileId = '';
    status.textContent = 'Viewing my local data. Shared files remain in the dataset list.'; update();
  }
  function chooseShared(fileId, navigate = true) {
    linkAccessProblem = false;
    epoch++; busy = false; resetSharing(); closePicker(); linkedFileId = fileId;
    showUnavailable(fileId, bookmarks.get(fileId) || 'Shared backup');
    if (!client.connected) {
      showUnavailable(fileId, bookmarks.get(fileId) || 'Shared backup', 'unavailable');
      status.textContent = 'Connect Google Drive in Maintenance to load this dataset. No local data is changed.'; update(); return;
    }
    operation(operationEpoch => openPreview(fileId, operationEpoch, navigate), 'Loading the selected shared dataset…');
  }
  datasetSelect.addEventListener('change', () => {
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
    else { selectAppView(maintenanceTab, true); status.textContent = 'Connect Google Drive, then choose Add a Drive file to add a dataset.'; update(); connect.focus(); }
  });
  function renderFileTable() {
    const body = byId('sharedDriveFilesBody');
    body.replaceChildren();
    byId('sharedDriveFilesEmpty').hidden = bookmarks.size > 0;
    byId('sharedDriveFilesTable').hidden = bookmarks.size === 0;
    bookmarks.forEach((label, id) => {
      const row = document.createElement('tr');
      const name = document.createElement('td'); name.textContent = label;
      const owner = document.createElement('td'); owner.textContent = fileOwners.get(id) || 'Shown when opened';
      const actions = document.createElement('td');
      const button = (text, action, requiresConnection = false) => {
        const control = document.createElement('button'); control.type = 'button'; control.textContent = text;
        control.setAttribute('aria-label', `${text}: ${label}`);
        control.disabled = busy || (requiresConnection && !client.connected);
        control.addEventListener('click', action); actions.append(control); return control;
      };
      button('View data', () => {
        if (!client.connected) { chooseShared(id); selectAppView(maintenanceTab, true); connect.focus(); }
        else { selectAppView(logsTab, true); chooseShared(id); }
      });
      const input = document.createElement('input'); input.type = 'text'; input.maxLength = 120; input.value = label; input.hidden = true;
      input.setAttribute('aria-label', `Name for ${label}`); name.append(input);
      const edit = button('Edit name', () => {
        if (input.hidden) { input.hidden = false; edit.textContent = 'Save name'; input.focus(); return; }
        const renamed = input.value.trim().slice(0,120);
        if (!renamed) { input.focus(); return; }
        bookmarks.set(id, renamed); persistBookmarks();
        const selected = getReviewDataset();
        if (selected?.fileId === id) setDataset({...selected,label:renamed});
        status.textContent = 'File name saved in this browser.'; update();
      });
      button('Refresh', () => chooseShared(id, false), true);
      button('Remove', () => {
        bookmarks.delete(id); fileOwners.delete(id); persistBookmarks();
        if (getReviewDataset()?.fileId === id) chooseLocal();
        status.textContent = 'File removed from your list. It is kept in Google Drive.'; update(); byId('addReviewDatasetButton').focus();
      });
      row.append(name,owner,actions); body.append(row);
    });
  }
  async function copyLink(fileId) {
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
      status.textContent = 'Ready to connect. Choose Connect Google Drive to select your account.';
    })().finally(()=>{ preparingGoogle=false;preparePromise=undefined;update(); });
    return preparePromise;
  }
  document.addEventListener('appviewchange',()=>{
    if (currentAppView === 'maintenance' && !tokenClient) prepareGoogle().catch(error=>{status.textContent=error.message;update();});
  });
  connect.addEventListener('click', () => {
    if (!tokenClient) {
      prepareGoogle().then(()=>connect.click()).catch(error=>{status.textContent=error.message;update();});
      return;
    }
    if (busy) return;
    epoch++; const requestEpoch = epoch;
    driveTree = undefined; cleanupPlan = undefined; byId('googleDriveBackupCleanup').hidden = true;
    pauseSync(); client.disconnect(); clearTimeout(accountExpiryTimer); connectedEmail = ''; resetSharing(); savedFileId = ''; savedPanel.hidden = true; clearPreview();
    busy = true; update(); status.textContent = 'Waiting for Google account selection and authorisation…';
    tokenClient.callback = async response => {
      if (epoch !== requestEpoch) return;
      busy = false;
      if (response.error || !google.accounts.oauth2.hasGrantedAllScopes(response, 'https://www.googleapis.com/auth/drive.file')) {
        status.textContent = 'Google connection was not authorised. Local records and file backups are available.';
      } else {
        try {
          client.setAccessToken(response);
          accountExpiryTimer = setTimeout(update, Math.max(0, Number(response.expires_in) * 1000 - 5000));
          accountExpiryTimer?.unref?.();
          busy = true;
          status.textContent = 'Checking the connected Google account…'; update();
          try { const email = await client.getConnectedEmail(); if (epoch === requestEpoch) connectedEmail = email; }
          catch { if (epoch === requestEpoch) connectedEmail = ''; }
          if (epoch !== requestEpoch) return;
          busy = false;
          if (!client.connected) throw new Error('Reconnect Google Drive to continue.');
          connect.textContent = 'Reconnect or switch Google account';
          status.textContent = 'Google Drive connected. Choose Save current, Create dated backup or Start Sync.';
          if (linkedFileId) operation(operationEpoch => openPreview(linkedFileId, operationEpoch), 'Opening the shared backup…');
        } catch (error) { busy = false; status.textContent = error.message; }
      }
      update();
    };
    // GIS captures error_callback at initialisation.
    const failed = () => {
      if (epoch !== requestEpoch) return;
      busy = false; status.textContent = 'Google sign-in was closed or could not open. Try again; your local records are kept.'; update();
    };
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({ client_id: config.clientId,
        scope: googleScopes, callback: tokenClient.callback, error_callback: failed });
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    } catch { failed(); }
  });
  function rememberedBaseline(fileId) {
    if (syncTarget?.id === fileId && syncTarget.owner === connectedEmail) return syncTarget.base;
    try { const saved = JSON.parse(localStorage.getItem(syncStorageKey) || 'null'); if (saved?.id === fileId && saved.owner === connectedEmail) return saved.base; } catch {}
    return null;
  }
  async function saveCurrent(operationEpoch) {
    if (!dataSchemaMatches() || !connectedEmail) throw new Error('Complete the local data upgrade and connect your Google account before saving.');
    if ((typeof editingEntry !== 'undefined' && editingEntry) || (typeof pendingRatingScaleChange !== 'undefined' && pendingRatingScaleChange)) throw new Error('Finish the current edit or scale review before saving to Drive.');
    const snapshot = getBackupSnapshot();
    driveTree = await client.getFolderTree();
    if (epoch !== operationEpoch) return;
    let current = await client.findCurrent(driveTree.folderId);
    if (epoch !== operationEpoch) return;
    if (!current) {
      const selected = getReviewDataset();
      const candidate = syncTarget?.owner === connectedEmail ? syncTarget.id : selected?.owner === connectedEmail ? selected.fileId : '';
      if (candidate) {
        current = await client.adoptCurrent(candidate, driveTree.folderId, connectedEmail);
        if (epoch !== operationEpoch) return;
      }
    }
    let merged = snapshot;
    if (current) {
      if (syncTarget && syncTarget.id !== current.id) throw new Error('Pause sync with the other file before saving the current file.');
      const before = await client.getUpdateState(current.id);
      const remote = await client.readBackup(current.id);
      const after = await client.getUpdateState(current.id);
      if (epoch !== operationEpoch) return;
      if (!before.editable || !before.owners?.some(owner=>owner.emailAddress===connectedEmail) || before.etag !== after.etag) throw new Error('The current Drive file changed or is not editable by this account. Try again.');
      const parsed = getBackupEntriesFromText(remote.text);
      if (parsed.skipped || remote.backup.schemaVersion !== snapshot.schemaVersion) throw new Error('The current file needs review before saving.');
      merged = EmotionWheelSync.reconcile(rememberedBaseline(current.id), snapshot, remote.backup);
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
    localStorage.setItem(syncStorageKey,JSON.stringify({id:current.id,owner:connectedEmail,base:merged}));
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
    const sorted = files.slice().sort((a,b)=>String(a.createdTime).localeCompare(String(b.createdTime)) || a.id.localeCompare(b.id));
    const extra = sorted.slice(0,Math.max(0,sorted.length-limit));
    cleanupPlan = extra.length ? {files:extra,folderId:driveTree.backupsId,owner:connectedEmail,epoch} : undefined;
    byId('googleDriveBackupCleanup').hidden = !cleanupPlan;
    byId('googleDriveCleanupList').replaceChildren();
    if (cleanupPlan) {
      byId('googleDriveCleanupSummary').textContent = `You have ${files.length} backups. Keep the newest ${limit}? These ${extra.length} oldest backups can be moved to Trash. The current file will be kept.`;
      extra.forEach(file=>{const item=document.createElement('li');item.textContent=`${file.name} — ${file.createdTime || 'date unavailable'}`;byId('googleDriveCleanupList').append(item);});
      byId('googleDriveCleanupHeading').focus();
    }
  }
  save.addEventListener('click',()=>operation(async operationEpoch=>{
    const result = await saveCurrent(operationEpoch);
    if (!result || epoch !== operationEpoch) return;
    status.textContent = `Current file saved with ${result.snapshot.entries.length} records in Emotion Wheel. Its sharing link stays the same.`;
    await reviewBackups(operationEpoch);
  },'Saving your current file…'));
  byId('createGoogleDriveBackupButton').addEventListener('click',()=>operation(async operationEpoch=>{
    const name = byId('googleDriveBackupName').value.trim().replace(/\.json$/i,'');
    if (!name || name.length > 80 || /[\\/\x00-\x1f]/.test(name)) throw new Error('Enter a backup name without slashes, up to 80 characters.');
    const limit = Number(byId('googleDriveBackupLimit').value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose a backup limit between 1 and 100.');
    const result = await saveCurrent(operationEpoch);
    if (!result || epoch !== operationEpoch) return;
    const date = new Date().toISOString().replace(/:/g,'-');
    await client.createBackup({...result.snapshot,exportedAt:new Date().toISOString()},{name:`${name} ${date}.json`,parentId:driveTree.backupsId,role:'backup'});
    if (epoch !== operationEpoch) return;
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
      status.textContent='The reviewed oldest backups were moved to Google Drive Trash. Your current file and newest backups are kept.';
    },'Moving the reviewed oldest backups to Trash…');
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
      const view = new google.picker.DocsView().setMimeTypes('application/json,text/plain');
      let selected = false;
      finishPicker = resolve;
      const picker = new google.picker.PickerBuilder().setDeveloperKey(config.apiKey)
        .setAppId(config.appId).setOAuthToken(client.getPickerToken()).addView(view)
        .setOrigin(location.origin)
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
            } else await openPreview(fileId, operationEpoch, Boolean(linkedFileId));
            resolve();
          } catch (error) { reject(error); }
          finally { if (epoch === operationEpoch) finishPicker = undefined; }
        }).build();
      activePicker = picker;
      picker.setVisible(true);
    });
  }, 'Choose a JSON backup in Google Drive…'));
  refresh.addEventListener('click', () => operation(operationEpoch => openPreview(previewFileId, operationEpoch, currentAppView !== 'maintenance'), 'Refreshing the shared backup…'));
  byId('closeGoogleDrivePreviewButton').addEventListener('click', chooseLocal);
  disconnect.addEventListener('click', () => {
    epoch++; driveTree = undefined; cleanupPlan = undefined; byId('googleDriveBackupCleanup').hidden = true; pauseSync(); client.disconnect(); clearTimeout(accountExpiryTimer); connectedEmail = ''; resetSharing(); busy = false; savedFileId = ''; clearPreview(); savedPanel.hidden = true;
    closePicker();
    connect.textContent = 'Connect Google Drive';
    status.textContent = 'Google Drive disconnected. Local records and Drive files are kept.'; update(); connect.focus();
  });
  function resetSharing() {
    pickingShareFile = false;
    sharingFileId = '';
    shareResultFileId = ''; byId('googleDriveSharingResult').hidden = true;
    byId('googleDriveSharingForm').hidden = true;
    byId('googleDriveRecipientEmail').value = '';
    byId('googleDriveNotifyRecipient').checked = false;
  }
  function showSharing(id, name, count, isCurrent) {
    resetSharing(); sharingFileId=id; sharingIsCurrent=isCurrent;
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
        },'Opening your current file…');
        if (epoch!==shareEpoch || !client.connected) return;
        if (existing) { savedFileId=existing.id;savedRecordCount=existing.count; }
      }
    }
    if (!savedFileId) {
      const prepared = await operation(operationEpoch=>saveCurrent(operationEpoch),'Preparing your current file to share…');
      if (!prepared || epoch!==shareEpoch || !client.connected) return;
    }
    showSharing(savedFileId,'Emotion Wheel current.json',savedRecordCount,true);
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
      status.textContent = `Viewer access granted to ${permission.emailAddress || approval.email}. Copy the ${approval.fileId === savedFileId ? 'saved copy’s' : 'selected dataset’s'} Emotion Wheel link and send it to them. ${approval.isCurrent ? 'They can see updates when you save or sync this current file.' : 'This link opens the selected backup, which is separate from your synced file.'}`;
    }, 'Granting the confirmed recipient Viewer access…');
  });
  byId('closeGoogleDriveSharingResultButton').addEventListener('click',()=>{resetSharing();update();byId('shareGoogleDriveCopyButton').focus();});
  byId('copyGoogleDriveResultLinkButton').addEventListener('click',()=>copyLink(shareResultFileId));
  byId('shareGoogleDriveLinkButton').addEventListener('click',async()=>{
    if (!shareResultFileId) return;
    const url=EmotionWheelDrive.sharingUrl(location.href,shareResultFileId);
    if (!navigator.share) { const copied=await copyLink(shareResultFileId); byId('googleDriveShareSheetStatus').textContent=copied?'This browser does not offer a share sheet. The link has been copied.':'This browser does not offer a share sheet. Copy the link above instead.';return; }
    try { await navigator.share({title:'Emotion Wheel shared data',url}); byId('googleDriveShareSheetStatus').textContent='Sharing finished.'; }
    catch(error) { byId('googleDriveShareSheetStatus').textContent=error.name==='AbortError'?'Sharing cancelled. The link is still available above.':'The share sheet could not open. Copy the link above instead.'; }
  });
  byId('googleDriveLinkSignInButton').addEventListener('click',()=>{
    if (client.connected && !linkAccessProblem) operation(operationEpoch=>openPreview(linkedFileId,operationEpoch),'Checking your access to the shared file…');
    else connect.click();
  });
  byId('googleDriveLinkPickerButton').addEventListener('click',()=>open.click());

  function pauseSync(message = 'Sync paused. Local records and the Drive file are kept.') {
    clearTimeout(syncTimer); syncTarget = undefined;
    byId('googleDriveSyncStatus').textContent = message;
  }
  function scheduleSync() {
    clearTimeout(syncTimer);
    if (!syncTarget) return;
    syncTimer = setTimeout(() => {
      if (busy) scheduleSync(); else runSync();
    }, 15000);
    syncTimer?.unref?.();
  }
  async function runSync() {
    if (!syncTarget || busy) return;
    const target = syncTarget;
    let success = false;
    await operation(async operationEpoch => {
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
      if (before.etag !== after.etag) throw new Error('Drive changed while reading. Sync paused; try again.');
      const parsed = getBackupEntriesFromText(remote.text);
      if (parsed.skipped || remote.backup.schemaVersion !== local.schemaVersion) throw new Error('The Drive schema or records require review before sync.');
      const merged = EmotionWheelSync.reconcile(target.base, local, remote.backup);
      const localNow = getBackupSnapshot();
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(localNow)) !== EmotionWheelSync.canonical(EmotionWheelSync.content(local))) throw new Error('Local data changed during sync. Try again.');
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(merged)) !== EmotionWheelSync.canonical(EmotionWheelSync.content(remote.backup)) ||
          EmotionWheelSync.canonical(merged.driveSync) !== EmotionWheelSync.canonical(remote.backup.driveSync)) {
        await client.updateBackup(target.id, { ...merged, exportedAt: new Date().toISOString() }, after.etag);
      }
      if (epoch !== operationEpoch || syncTarget !== target) return;
      if (EmotionWheelSync.canonical(EmotionWheelSync.content(merged)) !== EmotionWheelSync.canonical(EmotionWheelSync.content(getBackupSnapshot()))) {
        applyDriveSyncSnapshot(merged, local);
      }
      target.base = merged;
      localStorage.setItem(syncStorageKey, JSON.stringify({ id: target.id, owner: target.owner, base: merged }));
      byId('googleDriveSyncStatus').textContent = `Synced ${merged.entries.length} records at ${new Date().toLocaleTimeString()}. Changes are checked every 15 seconds while connected.`;
      status.textContent = 'Two-way sync complete. Local and Drive changes have been reconciled.';
      success = true;
    }, 'Checking both copies for changes…');
    if (syncTarget !== target) return;
    if (!success) {
      clearTimeout(syncTimer);
      byId('googleDriveSyncStatus').textContent = `Sync paused. ${status.textContent} Use Sync now after reviewing both copies. No automatic retry will overwrite a conflict.`;
    } else scheduleSync();
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
  byId('startGoogleDriveSyncButton').addEventListener('click', async () => {
    if (!syncSafetyVerified || !connectedEmail || !client.connected || busy) return;
    const prepared = await operation(operationEpoch => saveCurrent(operationEpoch), 'Preparing your current Drive file…');
    if (!prepared || !savedFileId || !client.connected || busy) return;
    syncTarget = {id:prepared.current.id,owner:connectedEmail,base:prepared.snapshot};
    runSync(); update();
  });
  byId('pauseGoogleDriveSyncButton').addEventListener('click', () => { pauseSync(); update(); });
  byId('syncGoogleDriveNowButton').addEventListener('click', runSync);

  update();
  if (linkedFileId || currentAppView === 'maintenance') prepareGoogle().catch(error=>{status.textContent=error.message;update();});
})();
