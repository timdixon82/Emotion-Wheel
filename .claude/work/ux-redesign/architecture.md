# Architecture: entry flow redesign, search and descriptions

Author: Jacob. Date: 2026-11-27. Tier 2. Status: for Tim's approval of the two decisions at the end.

## 1. How stored data looks today

All line numbers are in `index.html` unless a file is named.

### Local log

- Key `emotionWheelLocalLogV1` (line 1390). Schema version in a separate key, the same name plus `SchemaVersion` (line 1392). Current `dataSchemaVersion` is 5 (line 1391).
- Written by `serializeDataset` (line 1779) as `{ schemaVersion, ratingScale, entries }`. `ratingScale` is 5 or 10.
- Older logs were a bare array of entries, read as scale 10 (`parseLocalDataset`, lines 1760-1767).
- Capture settings live in a separate key, `emotionWheelCaptureSettingsV1` (line 1393), saved by `saveSettings` (line 1881).
- Other keys: theme (lines 1699-1712), daily congratulation day (line 1394), Drive sync preference (`assets/google-drive-ui.js` line 139-150), and recovery snapshots (`...BeforeSchemaMigration`, `...BeforeRatingScaleChange`, `...BeforeDriveSync`, `...BeforeReplacement`).

### Entry record fields

Built at line 4596 onwards: `id`, `createdAt`, `modifiedAt`, `timestamp`, `level`, `inner`, `middle`, `outer`, then optional `appropriate`, `expectedIntensity`, `actualIntensity`, `intensityAlignment`, `physicalSensations`, `sensationGuide`, `tags`, `values`, `bucketLevel`, `comment`. Also `legacyIdentity` and `conflictOf`. The `level` value is the text "Inner circle", "Middle circle" or "Outer circle" (lines 1923-1935). It is stored data, so the heading renames must not touch it. Display code should map the stored value to the new wording.

The record spread `...entry` (line 4219) and the `extra` list (line 4205) mean unknown record fields are carried through, not dropped.

### Backup file

`getBackupSnapshot` (line 4085): `{ version: 3, schemaVersion, ratingScale, settings, exportedAt, tags, entries }`. A pre-upgrade variant adds `recovery` (line 4077). Read by `getBackupEntriesFromText` (line 4264), which rejects a `schemaVersion` above the app's (line 4271) and normalises each record with `normalizeLoadedEntry` (line 4209), which skips invalid records.

### Google Drive file

The Drive "current" file is a backup snapshot plus `driveSync: { version: 1, deletedIds, restoreRevision? }` (`assets/google-drive-sync.js` lines 84 and 94). Drive also holds backup files and a shared-list file (`assets/shared-dataset-list.js`, `kind` and `version: 1`). The three-way merge (`reconcile`, sync.js line 80) merges every top-level key, and the `settings` key is resolved by `pick`, so a settings difference between two devices can raise a conflict. Applying a Drive snapshot writes `snapshot.settings` into the settings key (line 4109).

### Existing versioning and migration

- Schema 5, with an upgrade dialog and local snapshot (`checkLocalDataSchema` line 1816, `migrateLocalDataset` line 1783). Data from a newer schema locks editing (line 1833).
- `prepareSchemas` (sync.js lines 100-136) upgrades older copies in memory for sync and rejects newer ones.
- Settings: `normalizeSettings` (line 1886) merges `{...defaultSettings, ...settings}`, so unknown settings keys survive in memory. It also handles legacy `collectIntensity` and `personalValues`. `normalizeTags` (line 1954) and `normalizeValues` (line 1964) clean those lists.

## 2. Data compatibility plan

### Planned changes and stored data

| Change | Stored data affected |
|---|---|
| Heading renames ("Core feeling" and so on) | None. Display text only. Keep the stored `level` strings unchanged. |
| Emotion search | None. Reads the `emotions` array. |
| Descriptions panel | None. Reads a static table. |
| Reordering questions, "Add detail" after Record | None to the record shape. Q-EW26 says detail saves into the same entry, using the existing edit path (`previousEntry`, line 4597). Same fields, same `id`. |
| Remembered descriptions setting | One new key, see below. |

Conclusion: no change to the record, backup or Drive formats, so no schema version bump.

### Where the new setting is stored

Store it in its own `localStorage` key, `emotionWheelShowDescriptionsV1`, with the value `"on"` or `"off"`. Default off. Reads and writes sit in try and catch, as the prototype does, so blocked storage is safe.

Do not put it in `captureSettings`. Reasons: `captureSettings` is written into every backup and into the Drive file, and Drive resolves it by three-way merge. A display preference would then sync between devices and could cause false settings conflicts. It also changes the capture-settings tests. A per-device display preference belongs next to the theme key, which is already device-local.

### Older versions

An older build never reads the new key, so it ignores it. Backups and Drive files do not contain it. Older builds cannot see any difference in records. If Tim later decides the preference should follow him across devices, it would go in `settings` as an optional key with default false. Older code keeps it in memory through the `...settings` spread, so that is also safe, but it needs a fresh decision.

### What would force a schema bump

Any of: a new required field; a rename or removal of a stored field; a change to the meaning or type of an existing field (for example storing a description or a new level label); a change to `driveSync` or the Drive file layout. Rule if it happens: raise `dataSchemaVersion` to 6; add an in-place, idempotent migration through the existing `migrateLocalDataset` path with its recovery snapshot and backup prompt; teach `prepareSchemas` the new target; keep reading schema 5; Jacob approves first. None is planned.

### Round-trip test (required before merge)

Add `tests/data-roundtrip.cjs`, run with the existing tests. Fixtures in `tests/fixtures/`, taken from real data of the current version (scrubbed of personal text first, with Tim's approval of the scrubbed copy): a local log, a backup file and a Drive-format file. Also one legacy bare-array log and one schema 4 file.

For each fixture:
1. Load it into the new build's loader (the same extraction approach as `tests/google-drive-sync.cjs`).
2. Re-serialise it (`serializeDataset`, `getBackupSnapshot`, and the Drive path through `prepareSchemas` and `reconcile` with itself as base, local and remote).
3. Compare with the original after JSON canonical sort, ignoring only `exportedAt`. Fail on any added, removed or changed key.
4. Assert that no output contains a description string, and that the new preference key is absent from backups and Drive files.
5. Compare against the output of the previous release's code for the same fixture (checked out from `main`), so the new build matches old behaviour.

Also test: loading a file saved by the new build in the previous build's loader (from `main`) gives identical entries.

## 3. Where descriptions live

- Create `assets/emotion-descriptions.js`, a static script loaded before the main script. It defines one frozen object keyed by `"Inner|Middle|Outer"` for outer emotions, and `"Inner|Middle"` and `"Inner"` for the higher levels. Using the full path avoids the duplicate-word problem ("Abandoned" under Sad Abandoned and under Sad Lonely, "Inferior" under Sad Depressed and Fear Insecure, "Inadequate" under Fear Insecure and Fear Rejected). Do not key on the bare name.
- Value shape: `{ text: "..." }`. Room is left for a later field, with no effect on records.
- It is only read by display code. No save, backup, sync or export function references it. A test enforces this (search the source for the descriptions identifier in those functions).
- Sync with the `emotions` array: the array stays the single source of truth in `index.html` (line 1389). Descriptions are keyed by path derived from it.
- Test `tests/emotion-descriptions.cjs`: derive every inner, middle and outer path from `emotions`; fail if any has no non-empty description, or is whitespace, or still contains the text PLACEHOLDER. Also fail on any description key that matches no emotion (catches typos and stale rows). Count check: 6 inner, 72 outer rows, as the array stands. Add a length cap so the panel stays readable.
- Until Tim approves each batch, the file can hold approved text only, with the completeness test marked as expected to fail for unapproved rows. Safer option: merge the file only when all 112 are approved, and ship the panel behind the preference until then. Recommendation: build search and the flow first, add descriptions in a later pull request once all batches are approved.

## 4. Order of pull requests and checks

Each pull request is small, builds on `main`, and runs `npm test` plus the accessibility suite. Carol's full feature regression runs before the last merge and, as a smoke pass, after pull requests 3 and 5.

1. **Fixtures and round-trip test, no app change.** Adds the fixtures and `tests/data-roundtrip.cjs`, and passes against current `main`. This is the safety net for everything after it. Checks: the new test; all existing tests.
2. **Skip link and heading renames.** Display text only. Risk: `tests/clear-entry-form.cjs`, `capture-options.cjs` and `release-readiness.cjs` read `index.html` as text and may match heading words or ids. Keep ids and the stored `level` values. Update test strings only where they match visible text. Checks: all tests; round-trip; Carol checks the log and charts still show the right level wording.
3. **Search.** New module reading `emotions`. Selecting a result must call the same selection state as the buttons (`selectedInner`, `selectedMiddle`, `selectedOuter`, line 1930 onwards), so Record, edit and clear work untouched. Checks: clear-entry-form test extended for the search route; editing an existing entry preselects correctly.
4. **Descriptions data file, test and the preference.** Adds `assets/emotion-descriptions.js`, the completeness test and the new key. Checks: round-trip asserts no description or new key in saved output. Add the file to the service worker or cache list if one exists (check, I did not read one).
5. **Descriptions panel and toggle.** Display only. Checks: accessibility suite; Carol's browser pass.
6. **Reorder: optional questions after Record.** The highest-risk change. Edit the form flow, not the save function. "Add detail" re-opens the saved entry through the existing edit path (`previousEntry`) so the `id` and `createdAt` stay. Risks: the `capture-options` tests, the clear-values fix just merged on `fix/clear-values-on-save` (commit c40cf07, which must land first), undo, the daily streak logic, and any Drive sync running between the two saves. Each save is a normal edit of one record, so sync sees two normal edits. Test that two saves yield one record, and that `modifiedAt` changes while `createdAt` and `id` do not. Needs Jed review.
7. **Final regression.** Carol's full checklist in a real browser; Jacob confirms data compatibility from the round-trip results.

Risks to flag:
- Google Drive: do not touch `assets/google-drive-*.js` or `shared-dataset-list.js`. The only touch point is the settings object, which we avoid by using a separate key. `tests/google-drive-sync.cjs` loads `index.html` text (line 53), so avoid moving or renaming functions it extracts.
- Tests read `index.html` as text, so large code moves break them silently. Keep new code in new files or additive blocks.
- A bump in saved-record behaviour during step 6 (two saves) could create extra Drive revisions. Acceptable, but check the sync debounce.
- `release-readiness.cjs` checks the page set. A new asset file may need listing there.

## 5. Structure: refactor first or not

Stay inside the single-page structure. No refactor first. Add new behaviour as new files in `assets/` (descriptions data, search) with small hooks in `index.html`. A refactor of a 4800-line file under a data-retention rule has more risk than the feature, and the tests depend on the file's text. If Tim wants a split of `index.html` later, make it a separate piece of work after this ships.

## Addendum 2026-11-28: descriptions preference stored in capture settings (Tim chose option b)

This supersedes the "Where the new setting is stored" and "Older versions" paragraphs above, and decision 1. Recommendation: option b is safe, provided the three rules below are followed. It is not safe if the key is simply added to `defaultSettings`. No fallback is needed.

### 1. Key, default and placement

- Key: `showDescriptions`. Type: boolean. Meaning of default: off.
- Do not add it to `defaultSettings` (`index.html` lines 1452-1465). Adding it there makes `normalizeSettings` (line 1887, `{ ...defaultSettings, ...settings }`) write `showDescriptions: false` into every device's saved settings. A new device would then differ from an old device that has never seen the key, and that difference counts as a settings change in the merge.
- Rule A, absent means off. Read it as `captureSettings.showDescriptions === true`.
- Rule B, canonical form. In `normalizeSettings` (lines 1886-1908, add before `return normalized` at line 1908): if `settings.showDescriptions === true` keep `normalized.showDescriptions = true`, otherwise `delete normalized.showDescriptions`. The toggle code does the same: set true, or delete the key. The key is only ever present as `true`. This keeps old files, new files with the preference off, and files that never had it byte-identical in the settings object.
- Rule C, key order. Line 4100 compares `JSON.stringify(captureSettings)` with the expected local settings, so key order matters. The toggle must always add the key by assignment (it lands last) and remove it by `delete`. Do not rebuild the object.
- It reaches backups and Drive automatically: `getBackupSnapshot` writes `settings: captureSettings` (lines 4081 and 4090). Line 4109 writes `snapshot.settings` into storage as is, and line 4120 re-normalises it.

### 2. Drive three-way merge

Today `assets/google-drive-sync.js` line 80 sends `settings` through `pick` (lines 31-39) as one block. `choose` (lines 11-16) raises a conflict when both sides differ from the base and from each other. So one device toggling descriptions while another changes any capture option (or the tag list inside settings) would pause sync with a false conflict. Existing behaviour already does this for any settings change; the new key makes it more frequent because it is toggled often.

Because the key is a two-state value (true, or absent), `choose` on the key alone can never conflict: if local and remote differ, one of them equals the base. The risk is only the whole-object comparison. Smallest safe change, in `reconcile` only:

- In the line 80 loop, for `key === 'settings'` only: split `showDescriptions` out of left, right and ancestor settings. Merge the rest with the existing `pick(..., 'settings')` exactly as today. Merge the key with last-writer-wins: equal, then that value; local equals base, then remote; remote equals base, then local; otherwise (cannot occur for a boolean, kept as a guard) take local. Re-add the key to the merged settings only when true (Rule B).
- A missing or non-object `settings` on any side falls through to today's code path unchanged.
- No other key, no entries or tags logic, no `driveSync` handling, no `google-drive-ui.js` change. The conflict screen still shows the whole settings block if other settings truly conflict; the key is simply excluded from that decision.
- Sean writes this as a small helper beside `reconcile` and Jed reviews it, as `assets/google-drive-sync.js` is sensitive (Tier 2). `tests/google-drive-sync.cjs` gains the cases in section 5.
- A toggle is a real settings change, so it produces one normal Drive upload. Not a conflict, not churn beyond one revision.

### 3. How an older build treats the key

- Load: `normalizeSettings` spreads unknown keys, so `showDescriptions` stays in memory. It is never dropped, and no code in the old build deletes unknown settings keys (only `personalValues`, line 1907).
- Re-save: `saveSettings` (line 1883) writes the whole `captureSettings`, so the key is preserved.
- Drive apply (line 4109) stores the raw settings, so it is preserved there too.
- Sync from an old device: the old `reconcile` treats the key as part of the settings block. Result: no churn in normal use. The only exposure is today's behaviour: if an old device and a new device change settings in the same sync window, the old device sees a settings conflict. This lasts only while the old build is in use. The old build cannot toggle or show the preference.
- Restore from a new backup into an old build: settings are validated only as an object (`google-drive-ui.js` lines 834-836), so it restores cleanly.

### 4. Schema version

No bump. Records, `schemaVersion` (5), backup `version` (3) and `driveSync` (1) are unchanged, and a new optional settings key is additive and tolerated in both directions. Nothing needs migrating: absence means off. Rule if this changes later (a required key, a rename, or a changed type or meaning): bump `dataSchemaVersion` to 6 with the migration path described in section 2 above. Do not bump for this key, because a bump would lock older devices out of editing and sync (`google-drive-sync.js` lines 105-106), which is far worse than the risk it removes.

### 5. Round-trip test plan, replaces steps 4 and 5 and the last paragraph of the test plan

Each fixture exists in two variants: without the key, and with `settings.showDescriptions: true`. Run both through new code and through the previous release from `main`.

1. New loads old file (no key): settings output has no `showDescriptions`; whole file identical after canonical sort, ignoring `exportedAt`.
2. New loads file with key true: key kept, everything else identical.
3. New with the preference off saves: key absent (not `false`). Toggle on then off returns the file byte-identical to the start.
4. Old code (from `main`) loads and re-saves the file with the key: key and all other fields preserved, entries identical. Old code applies a Drive snapshot containing the key: stored settings still contain it.
5. New code loads a file saved by old code after step 4: identical.
6. Merge tests in `tests/google-drive-sync.cjs`, new `reconcile` and old `reconcile`: (a) A toggles on, B unchanged: A wins, no conflict. (b) A toggles on, B changes another setting: merged has both, no conflict (old `reconcile` is expected to conflict here, recorded as known). (c) A on then off, B unchanged: no change. (d) Both toggle on: no change. (e) Both change another setting differently: still a conflict (unrelated behaviour untouched). (f) Base missing, local with key, remote without: no key-only conflict. (g) Settings missing or malformed: identical to current behaviour.
7. Assert no description text appears in any output, and that `normalizeSettings` of `{}` and of `{showDescriptions:false}` contains no `showDescriptions` key.
8. Capture-settings tests (`tests/capture-options.cjs`) still pass unchanged; add a case for the key.

### Effect on the pull-request order

Pull request 1 gains the key-with-and-without fixtures. Pull request 4 adds the `normalizeSettings` rule. A new pull request 4b, before the panel toggle ships, changes `reconcile` and its tests, with Jed's review. The preference toggle is not shipped until 4b has merged, so devices never meet the key without the merge rule. If 4b slips, fall back to the smallest alternative: the per-device key described earlier, which needs no sync change.

## Decisions for Tim

1. Store the "Show and read descriptions" preference per device in its own key (recommended), or sync it across devices through the capture settings? Recommended: per device.
2. Ship the panel only after all 112 descriptions are approved (recommended, so the completeness test can be strict), or ship with a partial set and a softer test?
3. Approve use of a scrubbed copy of real data as test fixtures (Tim to supply or approve the sample).

## Addendum 2 2026-11-28: search also matches description text (Tim's decision, reverses Q-EW22 a)

The count is now 114 descriptions (6 inner, 36 middle, 72 outer, one per path, Q-EW34 a). Earlier "112" figures are stale.

### 1. New pull request order

1. Fixtures and round-trip test (unchanged).
2. Skip link and heading renames (unchanged).
3. Descriptions data file `assets/emotion-descriptions.js` and `tests/emotion-descriptions.cjs`. Data and test only. No visible change, no preference key.
4. Search, reading the descriptions file.
4b. `reconcile` change for `showDescriptions`, plus the `normalizeSettings` rule (Rule B), with Jed's review.
5. Descriptions panel and toggle (after 4b).
6. Reorder of optional questions. 7. Final regression.

This replaces the old pull request 3 and 4. The old advice to build search first and add descriptions later no longer holds.

### 2. How search reads the descriptions

- Search loads `assets/emotion-descriptions.js` (script tag before the search code) and builds its index once at start from the `emotions` array. Each index row is one path: inner, middle or outer, with the display name, the full path and the description looked up by the full path key `"Inner|Middle|Outer"`. Never look up by bare name.
- Duplicates (Abandoned, Inferior, Inadequate) are separate rows because each has its own path and its own description. Results show the full path next to the name so Tim can tell them apart, and selection sets `selectedInner`, `selectedMiddle` and `selectedOuter` from the row's path, as the name-only design already did.
- Matching: case-insensitive, accents and punctuation ignored, every typed word must match inside the same field (name, or description).
- Ranking: (a) name matches first, ordered exact, then name starts with, then a word in the name starts with, then contains; ties by wheel order. (b) Then description-only matches, in wheel order. A row appears once, in the name group if it matches by name. Each description-only result shows the matching description text with the match marked using real text emphasis, not colour alone. A name result with a description match may also show it.
- Missing key: a row with no description is searchable by name only and never breaks search. The test in section 5 makes this impossible to ship.

### 3. Performance and existing tests

- 114 rows of under 30 words each: a plain scan per keystroke is instant. No index library, no debounce beyond ordinary input handling.
- Descriptions sit in a separate file, so `index.html` text grows only by a script tag and a small search hook. The tests that read `index.html` as text (`clear-entry-form.cjs`, `capture-options.cjs`, `release-readiness.cjs`, and the extraction in `google-drive-sync.cjs`) are not affected by description content. Risks: `release-readiness.cjs` may need the new file listed, and any service worker or cache list must include it (not yet checked). Keep the search code in its own file so function extraction by the Drive test is unchanged.

### 4. Stored data

Search is read-only. It changes no record, backup, Drive file or setting. The data compatibility conclusion, schema 5 and no bump, stands.

### 5. Added tests

In `tests/emotion-descriptions.cjs` (pull request 3):
1. Every one of the 114 paths derived from `emotions` has a description that is non-empty, contains no PLACEHOLDER, and is 30 words or fewer.
2. Every description is marked approved. The data file carries an approved flag or an approved-list file checked by the test, set only by Sonja after Tim's approval.
3. No duplicate keys, and no key that matches no path (typos, stale rows). Duplicate bare names (Abandoned, Inferior, Inadequate) each have two distinct entries.

In the search test (pull request 4):
4. For a sample of emotions, a word that appears only in the description (not in any name) returns that emotion, in the description group, after all name matches, and the result shows the matching description text.
5. Name matches rank before description matches; the same emotion is never listed twice.
6. Searching a duplicate name returns each path separately with its own description.

In `tests/data-roundtrip.cjs` (extends the existing plan):
7. After selecting an emotion through search and saving, no description text appears in the saved record, the local log, the backup snapshot or the Drive-format file. Also a source check that no save, backup or sync function references the descriptions identifier.

### 6. What blocks the search pull request

All 114 descriptions must be approved by Tim, and the completeness test must pass strictly. About 108 are approved or about to be; the remaining 6 block merging pull request 4 (and pull request 3 if it is to pass strictly). Search code can be built on a branch meanwhile, but not merged. Do not weaken the test to unblock it.
