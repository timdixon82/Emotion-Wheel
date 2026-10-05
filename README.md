# Emotion Wheel - Tracking your emotions

Emotion Wheel is an accessible, single-page tool for recording and reflecting on emotions in your own browser. It is designed to make everyday entry simple while providing richer review tools when you want to spot patterns.

Open `index.html` in a modern browser, or use the GitHub Pages site once published.

## What it does

- Record an emotion from the inner, middle, or outer level of the wheel. You never need to complete every level before recording.
- Start with Phase 1 for simple habit-building, move to Phase 2 for guided reflection, Phase 3 for context and bucket level, or use Custom to choose the fields that suit you.
- Add an optional private note to each entry, such as what happened, a thought, or useful context.
- See the active capture mode without opening settings, and use the compact mobile recording action without adding a duplicate screen-reader control.
- Move directly between Entry, Review Logs, Review Charts, My Data, Share My Data, Data Shared with Me, and Help using responsive app navigation that collapses into a menu on smaller screens.
- Review logs, tallies, charts, and a line chart of records over time.
- Move through chart periods by day, week, or month. Zero-entry periods can be included to show gaps in the pattern.
- Compare inner-circle emotion trends and choose which colour-coded series to display.
- Correct entries, use an existing entry as the start of a new one, or delete with an immediate undo option.
- Share an image captured from the chart currently displayed on screen through the device's native share sheet when supported, with clipboard and download fallbacks.
- Save, load, merge, replace, share, export, and clear your local data.
- Optional Google Drive connection is being developed on a local feature branch. The preview supports two-way sync, dated backups with comments, backup restore and shared files read-only in Logs and Charts after Google configuration and authorisation. Production Google setup and final live testing are still required.

## Privacy

Your entries, optional notes and settings are saved in this browser on this device. You can also choose exports, sharing or optional Google Drive saving and automatic sync. Emotion Wheel has no developer-operated service receiving your emotion records; GitHub hosts the app code. The site uses GoatCounter for anonymous pageview statistics; it does not receive your emotion records or track actions within an entry.

Your saved emotion content only leaves the browser when you deliberately export a CSV or JSON backup, save or sync data to Google Drive, share a chart or table, or copy information. Clear local log removes the active log but retains recovery snapshots and sync comparison data. Clearing this site's browser data removes its local copies; it does not remove Drive files or copies on other devices. See the Privacy notice before deleting data.

Read the fuller [privacy notes](docs/privacy.html) before using this for sensitive information.

## Getting started

1. Open Entry from the app navigation.
2. Choose Phase 1, Phase 2, Phase 3, or Custom in Capture settings if you want to change the recording fields.
3. Select an emotion at any level and add an optional note if helpful.
4. Select **Record this emotion**.
5. After saving, undo the entry, prepare another like it, or start a clean entry.
6. Open Logs or Charts from the Review group when you want to explore your records, or My Data when you want to export, back up, load, or clear data.

Phase 1 is recommended for at least one week to build the recording habit. Phase 2 then adds optional questions about appropriateness, expected and actual intensity, intensity alignment, and physical sensations. New recordings use equal expected and actual intensity ratings for alignment. Logs, charts, filters and exports use each record’s saved alignment result; existing results are preserved until a rating-scale conversion is performed or the record’s intensity ratings are explicitly changed. Editing only a note or another field preserves the saved alignment result.

## Design and themes

The interface follows Tim Dixon's design system: Roboto type, navy card hierarchy, accessible tables, 44-pixel minimum control targets, and four colour modes.

- Light
- Dark
- Muted Light
- Muted Dark

Choose a theme from the top-right control on wider screens or from the Menu on smaller screens. The preference is saved locally in the browser. The two muted themes are intended for people who prefer a calmer, lower-saturation experience.

The rendered design and accessibility notes are in [docs/accessibility.html](docs/accessibility.html), with the source notes in [docs/design-system.md](docs/design-system.md).

## Accessibility

- A skip link takes keyboard and screen reader users directly to the main content.
- App navigation follows the normal keyboard Tab order, identifies the current section, and moves focus to the selected content.
- On smaller screens, the Menu button exposes its expanded state and Escape closes the navigation and returns focus to the button.
- Secondary Entry reference content uses native collapsed sections, while sections in Logs, Charts, and My Data expand whenever their tab opens. The optional entry note remains expanded.
- Focus follows the visible entry sequence: emotion levels, optional reflection fields, the always-visible optional note, then Record. Reset returns focus to the Step 1 heading.
- Intensity uses labelled decrease and increase buttons with announced values, avoiding reliance on a screen-reader slider gesture.
- Mobile recording uses the same Record control in an in-flow action area, avoiding overlays and duplicated controls for screen readers.
- The wheel has a text-based selector and a full reference table; choosing any word in a table row prepares that complete emotion path.
- Charts have plain-language summaries, visible keys, accessible line or bar visuals, and matching data tables. Shared chart images capture the displayed chart and its key.
- Tables have captions and column headings, and become labelled row cards on smaller screens to avoid sideways scrolling.
- Dense log tables use labelled horizontal scrolling instead of cramped wrapping, include text/date/emotion/level filters, and pair emotion names with supplementary category colours.
- Focus indicators and controls work in every colour mode.

## Data and backups

The optional Google Drive preview does not require a Google account during normal use. Google sign-in is prepared when you open My Data, Share My Data, Data Shared with Me or a shared link. Connect Google Drive then opens account selection in one click and requests per-file access. Ordinary Entry, Logs and Charts use needs no Google connection. Access tokens stay in memory. A sharing link contains a Drive file ID, never a token or the records themselves. Google permissions govern access to the original file; they cannot recall a previously downloaded copy.

 Save to Drive checks and merges your current file; Create dated backup makes a separate named copy. Automatic sync is an explicit option for your current file, with a baseline stored locally, deletion markers, conflict choices and recovery copies. Sync runs every 15 seconds while connected and pauses on reload or disconnect. Share my data grants a named recipient Viewer access, with email notification optional, then provides a link and browser sharing controls. Data Shared with Me lists received files. The header or mobile menu selects local or shared data and has a Sync On/Off button that opens the My Data sync section; connected-account details appear in My Data. Shared files are read only; their contents stay in memory. File IDs and labels are remembered locally and, when connected, merged through a separate Emotion Wheel shared files.json in the user’s own Drive. Removal markers prevent older devices from restoring removed references. Shared records are never included in that list; different accounts keep separate lists. A sync-error banner links to My Data on every page. [Help](docs/help.html) explains the complete workflow in plain language.

See [Google Drive development and setup](docs/google-drive-development.md). Run `node tests/google-drive.cjs` and `node tests/google-drive-ui.cjs` alongside the existing regression checks. Mocked checks do not replace real owner/Viewer permission testing.

All entries, including optional notes, are included in JSON backups and full-log CSV exports. Loading a backup can either merge new records into the current log or replace it after confirmation. Older backups without notes remain valid.

## Development

This is a static HTML, CSS, and JavaScript app. There is no build step.

- Open `index.html` in a browser for a quick local check.
- Use the HTML validator and JavaScript syntax check configured in `.github/lint-tools` when available.
- The GitHub Actions workflows provide additional continuous integration checks.
- Follow [the release guide](docs/releasing.md) and bump the application version for every release.

## Licence

This project is available under the [MIT Licence](LICENSE).

## Phase 3: tags and emotion bucket level

Phase 3 includes Phase 2 reflection plus optional multiple tags and an emotion bucket level using the chosen rating scale (the maximum means full). Custom can enable either field independently. Bucket level describes overall emotional capacity and is separate from emotion intensity; it starts at the midpoint when enabled for capture. Older entries without a bucket level remain Not recorded.

Tags start with Work, Family, Relationship, Friends, Health, Sleep, Money, Home, Exercise, Social, Study, Travel and Caring responsibilities. Create more tags in Entry; names are trimmed and duplicates are matched without regard to case. New tags are selected immediately and saved for reuse. Logs and shared/exported tables include both fields, and log search matches them. Reflection charts show tag counts, bucket-level counts and the average recorded bucket level for the selected period. Multiple tags can make tag counts exceed entry counts; missing bucket levels are excluded from averages.

Existing records and storage keys are retained. Backups include both new fields and the reusable tag list; older backups remain supported. Editing with a field disabled preserves its existing value. With the field enabled, deselecting all tags or choosing Not recorded clears that field on the edited entry.

### Analysing tags and bucket levels

Charts now include ranked tag counts and percentages, emotions for a selected tag (inner categories or recorded paths), and an emotion-by-bucket-level heatmap with totals and missing values. All use the selected chart period. Select a bar or heatmap cell to open matching logs with the same period, tag, emotion and bucket filters. Logs also offer independent tag and bucket filters. No records are changed by analysis.

Log filters support multiple emotions, tags and bucket levels using native checkboxes. Within emotions and bucket levels, any selected value matches; tags offer any/all matching. The groups combine with each other and the inclusive date range. Empty groups mean all values. Chart drill-down selects the corresponding checkboxes.

### Record identity and backup compatibility

Records now carry a permanent UUID in `id`, plus `createdAt` and `modifiedAt`. The existing `timestamp` remains the recorded date used by logs and charts. Legacy records receive an ID once; missing metadata dates use their recorded timestamp because historical edit dates are unknown. The original local JSON is retained before migration. No storage keys change.

Version 3 JSON backups contain these fields, the rating scale and capture settings. Version 1 and 2 backups remain importable; legacy content matching prevents repeat imports creating duplicates. Records with the same GUID but different contents prompt a review: keep current, use backup, keep both, or cancel the entire merge. Keeping both assigns a new GUID to the additional record. Replacement still requires confirmation and saves the previous log locally first. Failed imports keep existing records.

Charts offer the same filters as Logs. Choose Custom in View chart period to show Advanced filters below the period controls and apply them to every chart. Choose All time, A day, A week or A month to return to normal period navigation. Advanced filters reset whenever the chart period selection changes. Chart drill-down carries the advanced criteria into Logs.

Run `node tests/context-analysis.cjs` for data, filtering, record identity and backup lifecycle regression checks.

Local data has a separate schema version marker (currently 3). The existing browser storage key is retained; its dataset now contains the entries and their rating scale together so they can be saved atomically. Older local arrays remain readable and migrate without changing their ratings or saved alignment results. On opening an older local dataset, a top banner requires an original-data backup download and confirmation that it has saved before migration. The app retains an exact local recovery snapshot of records and settings before writing. Adding, editing, deleting and importing data, including capture settings, are blocked throughout the app until the upgrade completes. Review, filtering and exports remain available. Closing the page before confirmation leaves the dataset unchanged. Backups include the schema version; older backup files remain supported.

### Rating scale

Open Capture settings, expand its Advanced settings section, then use Rating scale to select 1–5 or 1–10. This choice applies to expected intensity, actual intensity and emotion bucket level in all phases. New users start with 1–5; existing datasets without scale metadata are treated as 1–10, even when all their recorded values are 5 or below. Once stored, the dataset’s scale is used on every opening. Phase presets preserve it.

Changing the scale with saved records shows an inline warning and confirmation within Advanced settings; it does not open a popup. Download the original-data backup and confirm it has saved before converting. Moving from 1–10 to 1–5 divides ratings by two and rounds up; moving back multiplies by two and cannot recover lost detail. Both directions recalculate alignment using equal expected and actual ratings. For example, expected 7 and actual 8 become 4 and 4, which are aligned. Existing saved alignment results drive views and exports until conversion. Missing values stay missing, and IDs, dates, notes, tags and other fields are preserved. A local recovery snapshot retains the exact original dataset and settings. Cancellation and failed storage writes leave the saved dataset unchanged.

Logs, filters, chart averages, bucket heatmaps and accessible recording controls follow the dataset’s scale. Backups record it explicitly. Replacing a log adopts the backup’s scale; merging into a non-empty log with a different scale requires confirmation to convert only the incoming records and recalculate their alignment. Backups without scale metadata use 1–10.

Drive saves use `Emotion Wheel/Emotion Wheel current.json`, keeping the same sharing link. Named, dated copies go in `Emotion Wheel/Backups`. The default backup limit is five; extra backups are listed oldest first and move to Trash only after confirmation. Save to Drive manually checks and merges both copies. Start Sync enables automatic checks; those two controls then become Sync Now and Pause Sync. The Data Shared with Me page lists shared files in a table with View data, Edit name, Refresh and Remove. View data opens Logs; shared data remains read only.

Share my data defaults to your current Drive file. Within the sharing form you may choose another file you own; its filename is shown before you choose Give access and get link. Shared-file rows cannot copy links or grant access.

Sync failures are flagged by a banner on every app page and the Sync menu button; selecting either opens My Data at the error. The sync section shows the last successful date. Conflicting records show both versions for individual selection; other changes still merge. Before applying choices, the app keeps both original copies locally and in dated Drive recovery backups, and checks that neither copy changed during review. Filename and email fields use larger full-width controls.

## Release history

See [What’s new / changelog](CHANGELOG.md) for published versions and changes. The app and information-page footers link to the same history.
