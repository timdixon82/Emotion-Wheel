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
  let config, tokenClient, activePicker, finishPicker, accountExpiryTimer, connectedEmail = '', pendingShare, savedRecordCount = 0, sharingFileId = '', sharingFileName = '', sharingRecordCount = 0;
  const googleScopes = 'openid email https://www.googleapis.com/auth/drive.file';
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
  let syncTarget, syncTimer, syncPending, syncSafetyVerified = true; // Live stale-ETag rejection verified on the synthetic file.
  const syncStorageKey = 'emotionWheelDriveSyncV1';
  function update() {
    connect.disabled = busy;
    save.disabled = open.disabled = refresh.disabled = busy || !client.connected;
    disconnect.disabled = !client.connected && !busy;
    byId('copyGoogleDriveLinkButton').disabled = busy || !savedFileId;
    byId('shareGoogleDriveCopyButton').disabled = busy || !savedFileId || !client.connected;
    byId('confirmGoogleDriveSharingButton').disabled = busy || !pendingShare || !client.connected;
    const accountText = client.connected ? (connectedEmail ? `Google Drive connected as ${connectedEmail}.` : 'Google Drive connected; account email is unavailable.') : 'Google Drive is disconnected.';
    byId('googleAccountStatus').textContent = byId('googleMaintenanceAccountStatus').textContent = accountText;
    const selected = getReviewDataset();
    datasetSelect.replaceChildren(new Option('My local data', 'local'));
    bookmarks.forEach((label, id) => datasetSelect.add(new Option(`${label} — ${id.slice(-6)}`, id)));
    if (selected && !bookmarks.has(selected.fileId)) datasetSelect.add(new Option(selected.label, selected.fileId));
    datasetSelect.value = selected?.fileId || 'local';
    byId('startGoogleDriveSyncButton').disabled = !syncSafetyVerified || busy || !client.connected || !connectedEmail || !(savedFileId || selected?.owner === connectedEmail);
    byId('syncGoogleDriveNowButton').disabled = busy || !syncTarget || !client.connected;
    byId('pauseGoogleDriveSyncButton').disabled = !syncTarget;
    byId('testGoogleDriveSyncGuardButton').hidden = location.hostname !== 'localhost' || selected?.fileId !== '1mJnWuoX58_YY9lzg5jm5t9Kdm1azZpD9' || selected?.owner !== connectedEmail;
    byId('testGoogleDriveSyncGuardButton').disabled = busy || !client.connected;

    byId('addReviewDatasetButton').disabled = busy;
    byId('refreshReviewDatasetButton').disabled = busy || !selected || !client.connected;
    byId('copyReviewDatasetLinkButton').disabled = !selected;
    byId('shareReviewDatasetButton').disabled = busy || !client.connected || !selected?.canShare || !connectedEmail || selected.owner !== connectedEmail;
    byId('removeReviewDatasetButton').disabled = !selected;
    byId('reviewDatasetNameControls').hidden = !selected;
    byId('reviewDatasetName').value = selected?.label || '';
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
    try { await action(operationEpoch); }
    catch (error) {
      if (epoch === operationEpoch) status.textContent = error instanceof SyntaxError ?
        'The Drive file or connection configuration is invalid. Your local records are kept.' :
        error.message || 'Google Drive is unavailable. Your local records are kept.';
      if (epoch === operationEpoch && error.code === 'drive-access' && linkedFileId && client.connected) {
        status.textContent += ' If you have access in Drive, choose Open a Drive backup and select this file to grant the app access.';
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
  async function openPreview(fileId, operationEpoch) {
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
    bookmarks.set(fileId, label);
    persistBookmarks();
    setDataset({ fileId, label, filename, owner, canShare: result.metadata.capabilities?.canShare === true, entries: parsed.validEntries, ratingScale: parsed.ratingScale, tags: parsed.tags || [], state: 'loaded' });
    byId('googleDriveSharedSummary').textContent = `${label}: ${parsed.validEntries.length} records, rating scale 1–${parsed.ratingScale}. ${parsed.skipped} invalid records skipped. Use the dataset selector to switch between shared files and your local data.`;
    previewFileId = fileId; preview.hidden = false;
    linkedFileId = '';
    if (!['logs', 'charts'].includes(currentAppView)) selectAppView(logsTab, true);
    status.textContent = `Shared dataset refreshed from Drive at ${new Date().toLocaleTimeString()}. Your local records and settings are kept.`;
  }
  function chooseLocal() {
    epoch++; busy = false; resetSharing(); closePicker(); clearPreview(); linkedFileId = '';
    status.textContent = 'Viewing my local data. Shared files remain in the dataset list.'; update();
  }
  function chooseShared(fileId) {
    epoch++; busy = false; resetSharing(); closePicker(); linkedFileId = fileId;
    showUnavailable(fileId, bookmarks.get(fileId) || 'Shared backup');
    if (!client.connected) {
      showUnavailable(fileId, bookmarks.get(fileId) || 'Shared backup', 'unavailable');
      status.textContent = 'Connect Google Drive in Maintenance to load this dataset. No local data is changed.'; update(); return;
    }
    operation(operationEpoch => openPreview(fileId, operationEpoch), 'Loading the selected shared dataset…');
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
    if (client.connected) { linkedFileId = ''; open.click(); }
    else { selectAppView(maintenanceTab, true); status.textContent = 'Connect Google Drive, then choose Open a Drive backup to add a dataset.'; update(); connect.focus(); }
  });
  byId('refreshReviewDatasetButton').addEventListener('click', () => refresh.click());
  byId('removeReviewDatasetButton').addEventListener('click', () => {
    const selected = getReviewDataset();
    if (!selected) return;
    bookmarks.delete(selected.fileId); persistBookmarks(); chooseLocal();
    status.textContent = 'Shared dataset removed from this browser’s list. The Drive file is kept.'; update(); datasetSelect.focus();
  });
  byId('renameReviewDatasetButton').addEventListener('click', () => {
    const selected = getReviewDataset();
    const label = byId('reviewDatasetName').value.trim().slice(0, 120);
    if (!selected || !label) { status.textContent = 'Enter a name for the shared dataset.'; update(); return; }
    bookmarks.set(selected.fileId, label); persistBookmarks();
    setDataset({ ...selected, label }); status.textContent = 'Dataset name saved in this browser.'; update();
  });
  async function copyLink(fileId) {
    if (!fileId) return;
    const url = EmotionWheelDrive.sharingUrl(location.href, fileId);
    try { await navigator.clipboard.writeText(url); status.textContent = 'Emotion Wheel link copied. Only people with Drive access can open it.'; update(); }
    catch { showCopyFallback('Copy Emotion Wheel sharing link', url, 'Select and copy this link. The recipient needs Viewer access in Google Drive.'); }
  }
  byId('copyReviewDatasetLinkButton').addEventListener('click', () => copyLink(getReviewDataset()?.fileId));
  byId('viewSharedLogsButton').addEventListener('click', () => selectAppView(logsTab, true));
  byId('viewSharedChartsButton').addEventListener('click', () => selectAppView(chartsTab, true));

  connect.addEventListener('click', () => {
    if (!tokenClient) {
      operation(async operationEpoch => {
        const settings = await readConfig();
        await loadScript('https://accounts.google.com/gsi/client');
        if (epoch !== operationEpoch) return;
        config = settings;
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: config.clientId, scope: googleScopes, callback: () => {}
        });
        connect.textContent = 'Sign in to Google';
        status.textContent = 'Google is ready. Choose Sign in to Google to select an account and authorise this connection.';
      }, 'Preparing the optional Google connection…');
      return;
    }
    if (busy) return;
    epoch++; const requestEpoch = epoch;
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
          status.textContent = 'Google Drive connected. Choose Save a copy or explicitly enable two-way sync.';
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
  save.addEventListener('click', () => operation(async operationEpoch => {
    if (!dataSchemaMatches()) throw new Error('Complete the local data upgrade before saving a Drive copy.');
    const snapshot = getBackupSnapshot();
    const file = await client.createBackup(snapshot);
    if (epoch !== operationEpoch) return;
    savedFileId = file.id; savedRecordCount = snapshot.entries.length; resetSharing();
    byId('googleDriveFileLink').href = `https://drive.google.com/file/d/${file.id}/view`;
    savedPanel.hidden = false;
    status.textContent = `Saved a new private Drive copy with ${snapshot.entries.length} records. Later changes need another save in this preview.`;
  }, 'Saving a new copy to your Google Drive…'));
  open.addEventListener('click', () => operation(async operationEpoch => {
    if (!client.connected) throw new Error('Reconnect Google Drive to open a backup.');
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve, reject) => gapi.load('picker', { callback: resolve,
      onerror: () => reject(new Error('The Google file picker could not load.')),
      timeout: 20000, ontimeout: () => reject(new Error('The Google file picker timed out.')) }));
    if (epoch !== operationEpoch) return;
    await new Promise((resolve, reject) => {
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
            if (linkedFileId && fileId !== linkedFileId) throw new Error('Choose the backup referenced by this sharing link.');
            await openPreview(fileId, operationEpoch); resolve();
          } catch (error) { reject(error); }
          finally { if (epoch === operationEpoch) finishPicker = undefined; }
        }).build();
      activePicker = picker;
      picker.setVisible(true);
    });
  }, 'Choose a JSON backup in Google Drive…'));
  refresh.addEventListener('click', () => operation(operationEpoch => openPreview(previewFileId, operationEpoch), 'Refreshing the shared backup…'));
  byId('closeGoogleDrivePreviewButton').addEventListener('click', chooseLocal);
  disconnect.addEventListener('click', () => {
    epoch++; pauseSync(); client.disconnect(); clearTimeout(accountExpiryTimer); connectedEmail = ''; resetSharing(); busy = false; savedFileId = ''; clearPreview(); savedPanel.hidden = true;
    closePicker();
    connect.textContent = tokenClient ? 'Sign in to Google' : 'Connect Google Drive';
    status.textContent = 'Google Drive disconnected. Local records and Drive files are kept.'; update(); connect.focus();
  });
  function resetSharing() {
    pendingShare = undefined;
    sharingFileId = ''; sharingFileName = ''; sharingRecordCount = 0;
    byId('googleDriveSharingForm').hidden = true;
    byId('googleDriveSharingConfirmation').hidden = true;
    byId('googleDriveRecipientEmail').value = '';
    byId('googleDriveNotifyRecipient').checked = false;
  }
  byId('shareGoogleDriveCopyButton').addEventListener('click', () => {
    if (!savedFileId || !client.connected || busy) return;
    resetSharing(); sharingFileId = savedFileId; sharingFileName = 'Emotion Wheel backup.json'; sharingRecordCount = savedRecordCount;
    byId('googleDriveSharingForm').hidden = false;
    byId('googleDriveSharingHeading').focus();
  });
  byId('shareReviewDatasetButton').addEventListener('click', () => {
    const selected = getReviewDataset();
    if (busy || !client.connected || !selected?.canShare || !connectedEmail || selected.owner !== connectedEmail) return;
    resetSharing(); sharingFileId = selected.fileId; sharingFileName = selected.filename; sharingRecordCount = selected.entries.length;
    selectAppView(maintenanceTab, true); byId('googleDriveSharingForm').hidden = false; byId('googleDriveSharingHeading').focus();
  });
  byId('cancelGoogleDriveSharingButton').addEventListener('click', () => {
    resetSharing(); update(); byId('shareGoogleDriveCopyButton').focus();
  });
  ['googleDriveRecipientEmail', 'googleDriveNotifyRecipient'].forEach(id => {
    byId(id).addEventListener(id === 'googleDriveRecipientEmail' ? 'input' : 'change', () => {
      pendingShare = undefined; byId('googleDriveSharingConfirmation').hidden = true; update();
    });
  });
  byId('reviewGoogleDriveSharingButton').addEventListener('click', () => {
    const input = byId('googleDriveRecipientEmail'); input.value = input.value.trim();
    if (!sharingFileId || !client.connected || busy || !input.reportValidity()) return;
    pendingShare = { fileId: sharingFileId, email: input.value, notify: byId('googleDriveNotifyRecipient').checked, epoch };
    byId('googleDriveSharingReview').textContent = `Give ${pendingShare.email} Viewer access to ${sharingFileName} (${sharingRecordCount} records, including notes and all recorded fields) owned by ${connectedEmail || 'the connected Google account'}? ${pendingShare.notify ? 'Google will send an email notification.' : 'No email notification will be sent.'} The recipient can view and download this snapshot. Future records are not automatically synced to it.`;
    byId('googleDriveSharingConfirmation').hidden = false;
    byId('googleDriveSharingConfirmHeading').focus(); update();
  });
  byId('confirmGoogleDriveSharingButton').addEventListener('click', () => {
    const approval = pendingShare;
    if (!approval || approval.epoch !== epoch || approval.fileId !== sharingFileId || !client.connected || busy) return;
    operation(async operationEpoch => {
      const permission = await client.shareWithViewer(approval.fileId, approval.email, approval.notify);
      if (epoch !== operationEpoch) return;
      resetSharing();
      status.textContent = `Viewer access granted to ${permission.emailAddress || approval.email}. Copy the ${approval.fileId === savedFileId ? 'saved copy’s' : 'selected dataset’s'} Emotion Wheel link and send it to them. This snapshot does not sync future changes.`;
    }, 'Granting the confirmed recipient Viewer access…');
  });
  byId('copyGoogleDriveLinkButton').addEventListener('click', () => copyLink(savedFileId));

  function pauseSync(message = 'Sync paused. Local records and the Drive file are kept.') {
    clearTimeout(syncTimer); syncTarget = undefined; syncPending = undefined;
    byId('googleDriveSyncConfirmation').hidden = true;
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
  byId('startGoogleDriveSyncButton').addEventListener('click', () => {
    const selected = getReviewDataset();
    const id = (selected?.owner === connectedEmail ? selected.fileId : '') || savedFileId;
    if (!syncSafetyVerified || !id || !connectedEmail || !client.connected || busy) return;
    syncPending = { id, owner: connectedEmail };
    byId('googleDriveSyncReview').textContent = `Enable two-way sync with Drive file ${id.slice(-6)} in ${connectedEmail}? Local and Drive records will be merged. A recovery snapshot is kept before changing local data. Deletions are tracked after the first sync. Conflicts pause syncing. Existing viewers will see the updated file. Sync pauses on reload or disconnect; reconnect and confirm to resume.`;
    byId('googleDriveSyncConfirmation').hidden = false;
  });
  byId('confirmGoogleDriveSyncButton').addEventListener('click', () => {
    if (!syncSafetyVerified || !syncPending || busy || !client.connected || syncPending.owner !== connectedEmail) return;
    const candidate = { ...syncPending, base: null };
    try {
      const remembered = JSON.parse(localStorage.getItem(syncStorageKey) || 'null');
      if (remembered?.id === candidate.id && remembered.owner === candidate.owner) candidate.base = remembered.base;
    } catch { /* First sync still preserves records and rejects conflicts. */ }
    syncTarget = candidate; syncPending = undefined;
    byId('googleDriveSyncConfirmation').hidden = true;
    runSync(); update();
  });
  byId('cancelGoogleDriveSyncButton').addEventListener('click', () => { syncPending = undefined; byId('googleDriveSyncConfirmation').hidden = true; });
  byId('pauseGoogleDriveSyncButton').addEventListener('click', () => { pauseSync(); update(); });
  byId('syncGoogleDriveNowButton').addEventListener('click', runSync);

  update();
})();
