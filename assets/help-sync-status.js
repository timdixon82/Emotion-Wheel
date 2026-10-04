/* Help only reads the last sync notice; it never connects to Google. */
(function showStoredSyncIssue() {
  'use strict';
  try {
    const saved = JSON.parse(localStorage.getItem('emotionWheelDriveSyncV1') || 'null');
    document.getElementById('helpSyncIssue').hidden = !saved?.syncError;
  } catch { /* Help remains usable if storage is unavailable. */ }
})();
