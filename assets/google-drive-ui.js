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
  const client = new EmotionWheelDrive.DriveClient();
  const scripts = new Map();
  let config, tokenClient, activePicker;
  let busy = false, epoch = 0, savedFileId = '', previewFileId = '', linkedFileId = '';
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('drive')) {
    try { linkedFileId = EmotionWheelDrive.validFileId(fragment.get('drive')); }
    catch { status.textContent = 'This Drive sharing link is invalid.'; }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    selectAppView(maintenanceTab, true);
    if (linkedFileId) status.textContent = 'Connect Google Drive to open this shared backup. Your personal log will be kept.';
  }

  function update() {
    connect.disabled = busy;
    save.disabled = open.disabled = refresh.disabled = busy || !client.connected;
    disconnect.disabled = !client.connected && !busy;
    byId('copyGoogleDriveLinkButton').disabled = busy || !savedFileId;
  }
  function clearPreview() {
    previewFileId = ''; preview.hidden = true;
    ['googleDriveSharedRecords', 'googleDriveSharedTally', 'googleDriveSharedChart'].forEach(id => byId(id).replaceChildren());
    byId('googleDriveSharedSummary').textContent = '';
    byId('googleDriveSharedChartSummary').textContent = '';
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
    const result = await client.readBackup(fileId);
    if (epoch !== operationEpoch) return;
    const parsed = getBackupEntriesFromText(result.text);
    const entries = parsed.validEntries;
    byId('googleDriveSharedSummary').textContent = `${result.metadata.name || 'Shared backup'}: ${entries.length} records, rating scale 1–${parsed.ratingScale}. ${parsed.skipped} invalid records skipped. This preview is separate from your personal log.`;
    byId('googleDriveSharedRecords').innerHTML = formatRowsAsHtmlTable('Shared emotion records', getLogRows(entries, parsed.ratingScale));
    const counts = countValues(entries.map(entry => entry.inner));
    byId('googleDriveSharedTally').innerHTML = formatRowsAsHtmlTable('Shared emotion counts', [['Emotion', 'Records'], ...counts.map(row => [row.label, row.count])]);
    renderBarChart(byId('googleDriveSharedChart'), byId('googleDriveSharedChartSummary'), counts, 'No shared records.', row => emotionColours[row.label]);
    previewFileId = fileId; preview.hidden = false; preview.focus();
    status.textContent = 'Shared backup opened for review. Your personal log and settings are kept.';
  }

  connect.addEventListener('click', () => {
    if (!tokenClient) {
      operation(async operationEpoch => {
        const settings = await readConfig();
        await loadScript('https://accounts.google.com/gsi/client');
        if (epoch !== operationEpoch) return;
        config = settings;
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: config.clientId, scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {}
        });
        connect.textContent = 'Sign in to Google';
        status.textContent = 'Google is ready. Choose Sign in to Google to select an account and authorise this connection.';
      }, 'Preparing the optional Google connection…');
      return;
    }
    if (busy) return;
    epoch++; const requestEpoch = epoch;
    client.disconnect(); savedFileId = ''; savedPanel.hidden = true; clearPreview();
    busy = true; update(); status.textContent = 'Waiting for Google account selection and authorisation…';
    tokenClient.callback = response => {
      if (epoch !== requestEpoch) return;
      busy = false;
      if (response.error || !google.accounts.oauth2.hasGrantedAllScopes(response, 'https://www.googleapis.com/auth/drive.file')) {
        status.textContent = 'Google connection was not authorised. Local records and file backups are available.';
      } else {
        try {
          client.setAccessToken(response);
          connect.textContent = 'Reconnect or switch Google account';
          status.textContent = 'Google Drive connected. Nothing is uploaded until you choose Save a copy.';
          if (linkedFileId) operation(operationEpoch => openPreview(linkedFileId, operationEpoch), 'Opening the shared backup…');
        } catch (error) { status.textContent = error.message; }
      }
      update();
    };
    // GIS captures error_callback at initialisation.
    const failed = () => {
      if (epoch !== requestEpoch) return;
      busy = false; status.textContent = 'Google sign-in was closed or could not open. Try again; your local records are kept.'; update();
    };
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: config.clientId,
      scope: 'https://www.googleapis.com/auth/drive.file', callback: tokenClient.callback, error_callback: failed });
    try { tokenClient.requestAccessToken({ prompt: 'select_account' }); } catch { failed(); }
  });
  save.addEventListener('click', () => operation(async operationEpoch => {
    if (!dataSchemaMatches()) throw new Error('Complete the local data upgrade before saving a Drive copy.');
    const snapshot = getBackupSnapshot();
    const file = await client.createBackup(snapshot);
    if (epoch !== operationEpoch) return;
    savedFileId = file.id;
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
      const picker = new google.picker.PickerBuilder().setDeveloperKey(config.apiKey)
        .setAppId(config.appId).setOAuthToken(client.getPickerToken()).addView(view)
        .setCallback(async data => {
          if (epoch !== operationEpoch) { resolve(); return; }
          if (data.action === google.picker.Action.CANCEL) { status.textContent = 'No Drive backup opened. Your personal log is kept.'; resolve(); return; }
          if (data.action !== google.picker.Action.PICKED) return;
          try {
            const fileId = EmotionWheelDrive.validFileId(data.docs[0].id);
            if (linkedFileId && fileId !== linkedFileId) throw new Error('Choose the backup referenced by this sharing link.');
            await openPreview(fileId, operationEpoch); resolve();
          } catch (error) { reject(error); }
        }).build();
      activePicker = picker;
      picker.setVisible(true);
    });
  }, 'Choose a JSON backup in Google Drive…'));
  refresh.addEventListener('click', () => operation(operationEpoch => openPreview(previewFileId, operationEpoch), 'Refreshing the shared backup…'));
  byId('closeGoogleDrivePreviewButton').addEventListener('click', () => {
    epoch++; busy = false; clearPreview(); linkedFileId = '';
    status.textContent = 'Shared preview closed. Your personal log is kept.'; update(); open.focus();
  });
  disconnect.addEventListener('click', () => {
    activePicker?.setVisible(false); activePicker = undefined;
    epoch++; client.disconnect(); busy = false; savedFileId = ''; clearPreview(); savedPanel.hidden = true;
    connect.textContent = tokenClient ? 'Sign in to Google' : 'Connect Google Drive';
    status.textContent = 'Google Drive disconnected. Local records and Drive files are kept.'; update(); connect.focus();
  });
  byId('copyGoogleDriveLinkButton').addEventListener('click', async () => {
    if (!savedFileId) return;
    const url = EmotionWheelDrive.sharingUrl(location.href, savedFileId);
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = 'Emotion Wheel link copied. Only people with Drive access can open the saved copy.';
    } catch {
      showCopyFallback('Copy Emotion Wheel sharing link', url, 'Select and copy this link. Give the recipient Viewer access in Google Drive first.');
    }
  });
  update();
})();
