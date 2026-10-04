# Optional Google Drive connection — development

Status: local development on `codex/google-drive-sharing`. Do not merge, tag,
push a release, or change Pages deployment until local testing is complete and
Tim authorises release. Google Drive remains optional; the local app and file
backups must keep working without a Google account or Google scripts.

## Google setup

Use a dedicated Google Cloud project owned by Tim. Begin in Testing with only
named test accounts. Do not enable billing or publish the OAuth app for this
local test.

1. Create the project at https://console.cloud.google.com/projectcreate.
2. Enable Google Drive API and Google Picker API in APIs & Services → Library.
3. Configure Google Auth Platform branding with Emotion Wheel, a support email
   and developer contact email. Use External audience so personal Google
   accounts can participate; remain in Testing and add owner and recipient test
   accounts.
4. Request only `https://www.googleapis.com/auth/drive.file`. This scope permits
   access to app-created or explicitly selected files. It is write-capable;
   Google's Viewer permission on a shared file separately prevents a recipient
   from writing to that file. Do not request access to all Drive files.
5. Create a Web application OAuth client. For local testing register
   `http://localhost:8765` as an authorised JavaScript origin. Keep the client ID
   and project number (Picker app ID); do not put a client secret in the app.
6. Create a browser API key for Picker, restricted to Drive and Picker APIs and
   the required website referrers. Google's current Picker guidance requires
   both the local app origin and `https://docs.google.com/*` because Picker uses
   a Google-hosted iframe. Use a separate development key/client if a production
   configuration already exists.
7. Verify owner write access and a different account's Viewer access locally.
   Possessing a file ID does not authorise the app. The recipient may need to
   choose the shared file in Picker once.

Credentials to configure: OAuth client ID, project number and restricted browser
API key. Keep access tokens in memory, never in local storage, URLs, analytics,
logs, or backups. Sign-in passwords and verification codes stay in Google.

Google pages:

- [Drive and Picker browser setup](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample)
- [Per-file access](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Browser authorisation and token expiry](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [File sharing](https://developers.google.com/workspace/drive/api/guides/manage-sharing)

## Implementation sequence

1. Add an isolated Drive adapter and local tests for denied/expired access,
   malformed files and preservation of complete JSON snapshots.
2. Load Google Identity Services and Picker only after an explicit Connect or
   Open shared data action. Add accessible Maintenance controls, account/file
   selection, save status and disconnect. Retain all existing offline features.
3. Reuse backup generation and validation. Use an ordinary Drive JSON file,
   rather than the unshareable hidden `appDataFolder`. Separate received shared
   records from the personal log; fetching shared data must not change personal
   records, capture settings or rating scale.
4. Create app links containing a file ID in a fragment, never an access token.
   First version: explicit saving and read-only shared preview with Refresh.
   Owners grant named recipients Viewer access using Drive's sharing screen.
5. Add automatic saving only after validating concurrency protection against
   real Drive responses. Preserve recoverable snapshots, mark pending changes,
   handle failed/ambiguous uploads, and prevent silent overwrites. Multi-device
   reconciliation needs a common baseline and deletion tracking as well as
   record IDs and modification dates; importing backups alone is not sync.
6. Update the privacy notice for optional uploads to Google, authorised-reader
   downloads and local copies. Disconnect retains local data and does not delete
   Drive files. Revoking Drive access cannot recall copies already downloaded.

## Local verification and release gates

Run the baseline with `node tests/context-analysis.cjs` and the Drive adapter
checks with `node tests/google-drive.cjs`. Serve the repository on the registered
origin using `python3 -m http.server 8765 --bind 127.0.0.1`, then open
`http://localhost:8765`. Local browser storage is separate from the live site's
storage; use synthetic records for testing.

Before release verify:

- No Google requests or sign-in requirement during normal local-only use.
- Explicit connect, declined consent, token expiry, reconnect, wrong account and
  disconnect with local data retained.
- Full JSON preservation of notes, fields, tags, settings, IDs and rating scale.
- Private shared-file access for a named Viewer, rejected uninvited account,
  revoked access, and shared preview isolation from personal records.
- Missing/deleted/oversized/malformed/newer-schema files; cancelled imports.
- Offline recording and pending saves; failed uploads; interrupted page loads.
- Before automatic sync: concurrent edits, record deletion, settings and scale
  conflicts, stale tab writes and safe recovery from each failure.
- HTML validation, existing regression checks, keyboard use, narrow viewport,
  screen-reader announcements, and Tim's iOS VoiceOver confirmation.

The local adapter tests do not establish that OAuth, Picker, or real Drive
permissions work. Those remain unverified until the Google project is configured
and tested with separate accounts. Keep the live release unchanged throughout.
