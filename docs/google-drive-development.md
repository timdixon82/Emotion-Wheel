# Optional Google Drive connection — development

Status: local development on `codex/google-drive-sharing`. Do not merge, tag,
push a release, or change Pages deployment until local testing is complete and
Tim authorises release. Google Drive remains optional; the local app and file
backups must keep working without a Google account or Google scripts.

Current Google project: `emotion-wheel-510615`, project number `391356585675`.
Drive and Picker APIs have been enabled. OAuth branding is created with
`tjdixon@gmail.com` for support and developer contact. Tim approved Google's
User Data Policy; the OAuth configuration is created in External / Testing mode,
with `tjdixon@gmail.com` and `tim@dixon-net.com` added as test users. The approved Web client
is created with only `http://localhost:8765` authorised. The approved Picker key
is created with website restrictions `http://localhost:8765/*` and
`https://docs.google.com/*`, and API restrictions for Drive and Picker only.
The consent configuration declares `drive.file`, `openid` and `userinfo.email`. Drive access remains per-file; the basic identity scopes display the verified connected email.

The browser credentials are configured in ignored
`assets/google-drive-config.local.json`; no OAuth client secret is stored. Local
configuration checks passed and the real Google sign-in library loaded. Tim
selected `tjdixon@gmail.com` and completed Google's prompt; the app received the
Drive connection and enabled its controls. The owner upload/download round-trip
passed with one synthetic Happy record. The second account opened and refreshed
the shared backup, and a revocation test blocked further reading. The in-app browser did not expose Google's
account popup to automation, so Tim completed account selection directly.

The local preview now has explicit connection, saving and shared-preview controls.
The current transport only creates new backup files; protected updates and
automatic sync remain later work. Development credentials belong in ignored
`assets/google-drive-config.local.json`, with `clientId`, `apiKey`, `appId` and
`origins` (including `http://localhost:8765`). The committed configuration is
blank. Only localhost checks for the ignored development file, and no
configuration is requested until the user chooses Connect.

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
4. Request `openid email https://www.googleapis.com/auth/drive.file`. The identity scopes display the connected account; the Drive scope permits
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
   Owners review and confirm named recipients’ Viewer access in the app, with notification off by default.
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
checks with `node tests/google-drive.cjs`. Run `node tests/google-drive-ui.cjs` for
optional connection, shared preview isolation, explicit saving and cancelled
sign-in checks. Serve the repository on the registered origin using
`python3 -m http.server 8765 --bind 127.0.0.1`, then open
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

The local adapter tests alone do not establish that OAuth, Picker, or real Drive
permissions work. Owner OAuth and Picker have now passed a real round-trip;
recipient Viewer reads and revocation have also been tested separately. Keep the live
release unchanged throughout.

## Local test results — 4 October 2026

The initial three Node suites above, JavaScript syntax checks, HTML validation for
`index.html` and `docs/privacy.html`, and `git diff --check` passed.

At `http://localhost:8765`, a synthetic Happy entry with a note was recorded,
retained after reload, found through log search, and counted correctly in charts.
Connecting without credentials reported that Google Drive is not configured,
kept upload/open/disconnect controls disabled, loaded no Google scripts, and
preserved the synthetic local entry. No browser errors were observed; GoatCounter
reported that localhost pageviews were not counted. A chart instruction that
incorrectly fixed the full bucket level at 10 was changed to refer to the highest
level of the configured scale.

The local browser is available for manual testing. Real owner Google sign-in,
upload, Picker selection, download and refresh passed. Cross-account Viewer
reading, refresh and revocation also passed. Automatic sync is not implemented; this preview creates an
explicit new backup on each save.

Tim approved uploading only the single synthetic Happy record and test settings.
One `Emotion Wheel backup.json` was created privately in the owner account.
The JSON read back from Drive matched the local backup's version, schema, scale,
settings, tags and entries exactly, including the note, ID and timestamps.
Opening it in the app showed a separate read-only preview. Refresh succeeded;
closing the preview left the original local log at exactly one entry.

The real download initially failed because the adapter rejected redirects.
Google's [download example](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
follows them. Only the media GET now follows redirects; metadata and uploads
still reject them, and cookies are omitted on every request. The
[Fetch standard](https://fetch.spec.whatwg.org/#http-redirect-fetch) removes the
Authorization header on a cross-origin redirect. Regression checks cover this
distinction and passed after the fix.

The synthetic file was then shared with `tim@dixon-net.com` as Viewer with
Notify people unchecked. Drive confirmed access updated, the recipient's Viewer
role and Restricted general access. After recipient sign-in, opening the link
correctly requested per-file selection in Picker. Picker listed the shared
synthetic file, but selecting it twice initially produced `Failed to fetch`.
Network failures now identify
whether checking access, downloading or saving failed, without including raw
credential-bearing error details. After reload and another recipient sign-in,
the link opened successfully without another Picker selection, and Refresh
succeeded. The original cause of the earlier fetch failure was not established.

Removing the recipient's Viewer grant made Refresh fail while checking access
and cleared the shared preview. A direct Drive visit explicitly signed in as
`tim@dixon-net.com` showed `Access denied` / `You need access`, independently
confirming permission removal. Disconnecting retained exactly the one original
synthetic local record. The app's denied refresh surfaced a network error rather
than the tailored 403/404 message; do not claim that error classification is
verified for every real denial response.

Viewer access was restored for the controlled recipient after this test, with
email notification disabled and general access still Restricted, so Tim can
continue manual trials. A third, never-invited account and iOS VoiceOver still
need manual verification before release.

Additional preparation: regression checks now cover Picker selection, cancellation,
duplicate callbacks, wrong-file selection from a sharing link, denied refresh,
account changes during streamed responses, and disconnect during downloads.
Picker explicitly uses the app origin, failed refreshes discard the shared
preview, and Google initialisation failures release controls for retry. A linked
file access failure explains how an authorised recipient can select the file in
Picker to grant per-file app access. Both Drive suites are included in CI, using
Node 22 for this dependency-free app.

A browser-downloaded synthetic JSON backup was inspected successfully: schema,
scale, note, ID and timestamps were retained. Loading a shared fragment opened
Maintenance, removed the fragment from the address bar, loaded no Google scripts
and preserved the synthetic local log. Keyboard activation of Connect worked.
The native file chooser could not be controlled by the in-app browser automation,
so browser-level backup restoration remains a manual check; automated merge and
restore lifecycle coverage passes. Local checks run under Node 26.8.2; the new
CI steps have not run on GitHub because the branch remains local.

## Manual trial once Google credentials are configured

Use synthetic data throughout. Localhost data is separate from the live app.

1. Record an emotion with a note. Reload; check Logs and Charts. Save a JSON
   backup, then Load and merge that same backup; there should still be one copy
   of the entry.
2. Connect Google Drive, choose the owner test account, and authorise the
   per-file scope. Confirm that connecting alone creates no Drive file.
3. Choose Save a copy. Open the resulting Drive file and check that its sharing
   is restricted. Grant the recipient test account Viewer access through Drive.
4. Copy the Emotion Wheel sharing link. In a separate browser profile signed
   into the recipient account, open it, connect, and select the same shared file
   in Picker if requested. The recipient's personal log must stay separate.
5. Check the shared log and counts. Close and disconnect; personal records must
   remain. Test a cancelled sign-in and a cancelled Picker selection.
6. Test an uninvited account, then revoke the recipient's Drive access and refresh.
   Access must fail without changing personal data. Previously downloaded copies
   cannot be recalled.

Local sharing links use `http://localhost:8765/` and are for testing in another
profile on the same computer. Cross-device testing needs a reachable test origin
and corresponding OAuth/key restrictions before release. Each save creates a new
snapshot and sharing link; the current preview does not update an earlier copy.

## Multiple datasets and guided sharing

The dataset selector now uses the existing Logs and Charts for shared backups.
It displays share owner, file name and short ID, with editable local labels.
Shared Entry and log actions are disabled; Maintenance continues to manage local data.
Only file IDs and labels persist; shared records, tokens and connected email stay
in memory. Selecting or refreshing a shared file rechecks Drive access. Removing
a dataset removes its bookmark without changing Drive.

Guided sharing reviews the complete snapshot and recipient before confirming
Viewer access. Email notifications are unchecked by default. Saving still creates
an explicit snapshot; automatic sync and protected updates are not implemented.

Run `node tests/review-datasets.cjs` alongside the other three suites. Regression
coverage includes all chart families, scales, filtering, local exports, 20 shared
files, aliases, cancellation races, owner/account labels, and confirmed Viewer
permission requests. The live browser also verified Google email identity for both controlled accounts,
shared Logs and Charts, and switching back to the unchanged local log. In-app
sharing confirmed the existing synthetic file’s Viewer access for
`tim@dixon-net.com`, with notification off. The recipient then loaded that same
file: connected account `tim@dixon-net.com`, share owner `tjdixon@gmail.com`,
Entry disabled, and the owner-only sharing control disabled. No additional
Drive file was uploaded. Twenty-file switching and cross-scale charts were
verified with synthetic regression fixtures, rather than twenty real Drive files.
All four Node suites, JavaScript syntax, HTML validation and diff checks passed.
Device VoiceOver and narrow-screen manual checks remain release gates.

Google identity reference: https://developers.google.com/identity/openid-connect/reference

## Two-way sync development

Two-way reconciliation now compares the last successful common baseline with
local and Drive copies. IDs distinguish entries; deletions are represented by
tombstones in `driveSync.deletedIds`, and propagate after a common baseline is
established. A deletion versus a concurrent edit pauses sync. Tombstones are
not automatically pruned: an older device must not reintroduce removed records.
Settings, schema and rating-scale conflicts pause rather than silently convert.

Explicit confirmation enables one owned editable file. Sync polls every 15
seconds while connected, pauses on failure, and requires confirmation after
reload or reconnection. A recovery snapshot precedes applying remote data.
The baseline is stored locally, with full own records, unlike shared bookmarks.
Drive updates use the v2 JSON ETag and an exact If-Match header, create a new
pinned revision, and pause when Google rejects a stale update or cannot supply
a baseline. Revision limits must pause safely; there is no automatic revision
deletion. An ambiguous upload is not automatically retried.

Shared datasets are fetched afresh on link opening, selection and Refresh, with
`cache:no-store`; they are not automatically polled while viewed. Ordinary reload
selects local data, retains shared bookmarks, and requires reconnection/selection.
The shared status now includes its latest successful download time.

`node tests/google-drive-sync.cjs` covers reconciliation. The UI suite additionally
covers confirmed merge, local/remote additions, deletion propagation, persistent
baselines, conflicts and disconnect. Live ETag validation remains in progress:
two initial sync attempts failed during the baseline request, before upload.
Do not release until real stale-ETag rejection, owner updates, second-device
pulls/deletions and interrupted-write recovery have all been demonstrated.

References:
- https://developers.google.com/workspace/drive/api/reference/rest/v2/files
- https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update

The developer-only stale-update probe is limited to the approved synthetic file
on localhost. Starting sync was held disabled until that probe returned Google’s 412
conflict response; that live check has now passed. It currently encountered intermittent read failures and a
generic update error; expanded HTTP status reporting and a format-preserving
stale ETag test are ready for the next signed-in check. No successful live sync
is claimed. All five Node suites and HTML/JavaScript checks pass.

The live safety probe subsequently passed: Google returned the stale-update
conflict, and the UI reported that the synthetic backup was not overwritten.
The same signed-in session is now testing normal conditional updates. Intermittent
metadata network failures remain a separate reliability concern.

Read-only network failures now retry at most three attempts with short delays.
Writes are attempted once and pause on ambiguous failures. Regression coverage
verifies this distinction.

Normal conditional sync then succeeded on the same file with one synthetic
record. The common baseline was established and no extra Drive file was created.
A temporary edit-and-restore test of the synthetic note is in progress.

The live temporary note edit reached the existing Drive file and was verified
by refreshing its read-only dataset. The original synthetic note was then restored
locally, synced successfully, and verified by another Drive-backed refresh.
The single original entry ID and original record timestamp were retained; editing
advanced its modification timestamp as intended. Sync was paused after testing.
No additional file was created. Real second-device/offline/conflict-resolution
trials remain release gates; fixtures do not substitute for those trials.

The local-apply regression also exercises the production function directly:
active edits and stale local data reject application; quota failure rolls back
the writes and retains the full recovery snapshot.
