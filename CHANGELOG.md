# Emotion Wheel changelog

Published versions and changes. The app version appears in its footer. Record schema and backup format have their own versions; an app update does not necessarily change your data format.

## 1.8.0

Released 9 October 2026.

- Custom capture settings now offers Expected emotion level, Actual emotion level and Emotion is appropriate independently. Existing combined settings enable both levels; saved records and historical alignment are preserved.
- When both levels are selected, alignment appears during recording and in the save confirmation. Editing one level preserves the other saved rating and updates alignment only when ratings change.
- The current streak is more prominent on Entry. The first new emotion saved each local calendar day confirms today’s log and the updated streak with congratulations and encouragement. A local date marker prevents repeats after reload, undo or deletion; edits, imports, sync and failed saves do not trigger it.
- A failed emotion save retains the entry form and original in-memory records for retry.

## 1.7.0

Released 6 October 2026.

- The Entry page shows consecutive local calendar days with one or more emotion records. Multiple records count once per day; a streak ending yesterday remains visible during today. Only your own log is counted, with no added storage or network requests.
- The Log page calls your own records My emotion log, including when synced with Google; shared logs remain labelled read-only.
- A separate compact connection section appears after this browser has connected once. Distinct coloured icons show connection and sync states, with right-aligned expiry and last-sync times, clear stopped/off/paused/issue labels, and Extend or Reconnect. Larger screens show additional text labels; full details remain accessible by keyboard, touch and screen reader.
- Standard Lucide icons are bundled locally with their licence; no icon-provider requests or tracking are added.
- The countdown updates locally using Google's actual token timeout. Extend requests fresh authorisation for the same verified account and resets the countdown on success; cancellation preserves the current connection and active sync until expiry.
- Help explains the countdown, renewal, and Google's fixed user-token lifetime.

## 1.6.0

Released 6 October 2026.

- Reconnect Google keeps you on the current page, with inline feedback and a visible, focused sync prompt when a choice is needed.
- Start Sync now remembers your preference for that account and current file. After reconnecting, sync resumes automatically using the saved comparison copy and existing conflict protection. Pause Sync turns automatic resumption off.
- A different account or file, missing baseline, unresolved issue, active edit or rating review, data upgrade, or shared-data context prevents automatic resumption.
- Help explains why Google connections expire and need renewing regularly. Privacy explains the local sync preference; Google access tokens remain in memory.

## 1.5.0

Released 5 October 2026.

- A top banner asks previously connected browsers to reconnect Google after reload or connection expiry, with a direct reconnect button.
- The reminder disappears once connected and remains available if sign-in is cancelled or fails. First-time local users do not see it.
- Help and Privacy explain the remembered connection flag. Access tokens remain in memory; automatic sync still requires Start Sync.

## 1.4.1

Released 5 October 2026.

- Data Shared with Me now places Add a Drive file and Refresh shared-file list below the files table, matching Share My Data.
- Shared-list sync status and file feedback appear beside these controls.
- Reference and log table sharing controls follow the data; chart sharing controls follow each chart and its accessible table.
- The sync-start offer stays within My Data. Help wording and information-page footers match the current app.

Sharing, sync and backups work as before. Record schema and backup format remain 3; record sync metadata and shared-list format remain 1.

## 1.4.0

Released 5 October 2026.

- **Shared-file lists across devices:** connect the same Google account to recover your list of received datasets. Names and removals merge through a separate file in your own Drive; shared records remain in the owners’ files. Different accounts keep separate lists.
- **Release history:** What’s new / changelog in every footer opens the GitHub version history.
- **Easier shared-file opening:** if Google needs file approval, its picker opens automatically and shows only the file from the sharing link. Confirm it to open the read-only logs.
- Sharing follows a clearer order: people with access, Add a person, then the link to send. The optional Google email notification appears beside the email field.
- My Data clearly labels local file backup and import controls.
- Sync status appears above Start Sync. After Google connects, an existing current file prompts Start syncing or Not now, without uploading or changing records until you choose.
- The backup table comes before the comment and creation controls. Less frequently used options are under Advanced Backup Settings.

Shared-file viewing and incoming links do not offer to sync someone else’s data. Record schema and backup format remain 3; sync metadata remains 1.

## 1.3.1

Released 5 October 2026.

- Share My Data now clearly explains when no current Drive file is available to the connected app. A finished check no longer leaves a “Checking” message behind.
- The version display now requests the release-specific script, avoiding an old version number being kept in the browser cache.

The optional Google Drive features from version 1.3.0 are unchanged. Record schema and backup format remain 3; sync metadata remains 1.

## 1.3.0

Released 5 October 2026.

- **Optional Google Drive:** keep using the app on your device, or connect Google to save your data online.
- **Sync between devices:** turn on automatic sync for your own log. If both devices change the same record, choose which version to keep. Temporary sync problems retry automatically, and a visible message helps you find any issue.
- **Backups you can recognise:** dated backups appear in a table with optional comments. Restore a backup or move an old one to Trash after reviewing the confirmation. Cleanup keeps the newest five by default.
- **Share your log:** give someone Viewer access to your current Drive file and send them the app link. The Share My Data page lists people with access and lets you stop sharing at any time; copies they already saved cannot be recalled.
- **Data Shared with Me:** view other people’s logs and charts, switch between datasets, and return to your own log. Shared data is read-only.
- **An app icon and installation help:** add Emotion Wheel to your phone’s Home Screen or install it through Chrome, Edge or Safari on your computer.
- **Clearer navigation and help:** My Data brings together your saving, sync and backups. A compact menu and plain-language Help make the app easier to use on phones and computers.

Your records stay in your browser unless you choose an export, sharing or Google Drive saving and sync. Emotion Wheel does not store your log on its own server. The updated Privacy notice explains Google access, recovery copies and the separate anonymous pageview statistics.

Share My Data has its own page in the menu, with Connect Google when disconnected. The people table reads access from Google Drive, with Add person and an on-page confirmation to Stop sharing. One sharing link below the table has Copy link and Share link controls, enabled when at least one person has access.

Compatibility: the app version is 1.3.0; the record schema and backup format remain version 3. Optional Drive sync metadata uses version 1. Existing records do not require conversion for this release.

## 1.2.0

Released 4 October 2026.

- Choose ratings out of 5 or 10 in Capture settings → Advanced settings.
- Existing logs keep their ratings until you confirm a scale change after saving a backup.
- Logs, charts, filters and backups follow the saved rating scale.

## 1.1.1

Released 2 October 2026.

- Emotion bucket levels use compact decrease/value/increase controls, matching the intensity controls on mobile.
- Keyboard focus stays on the control at its limits.

## 1.1.0

Released 2 October 2026.

- Optional Phase 3 and Custom capture add tags and emotion bucket levels.
- Logs and charts gain filters and context analysis.
- Stable record IDs, dates, conflict choices and recovery copies improve backup handling.
- Older local datasets require a backup before their data format is updated.

Full release notes are available in [GitHub Releases](https://github.com/timdixon82/Emotion-Wheel/releases).
