# Requirements: Entry flow redesign, search and descriptions (build stage)

Tier 2. Source: `brief.md`, Simon's design note `outputs/spikes/2026-11-27-ux-review.md`, and the prototype README. Decisions Q-EW25 to Q-EW29 are applied as written in the brief. Each requirement has one acceptance test sentence that can be answered true or false.

## 1. Entry page structure

**R1. Skip links.** The page offers a "Skip to main content" link and a "Skip to Record this emotion" link, first in the tab order, visible on focus.
Test: Pressing Tab once on load shows a skip link, and pressing Enter on "Skip to Record this emotion" puts focus on the Record button.

**R2. Renamed step headings (display text only).** Step 1 reads "Main feeling", Step 2 "More specific (optional)", Step 3 "Most specific (optional)", replacing "Inner circle", "Middle circle" and "Outer circle". Heading ids, data fields and the stored words inner, middle and outer do not change.
Test: The three headings show the new text, and a saved record still holds the fields `inner`, `middle` and `outer`.

**R3. Help and wheel wording agree.** Help page and any other visible text that says "circle" is updated or explained so it matches the new headings.
Test: A search of the pages for "inner circle", "middle circle" and "outer circle" finds none that conflict with the new headings.

**R4. Steps 2 and 3 appear when earned.** Step 2 shows only after a Step 1 choice, and Step 3 only after a Step 2 choice. Focus moves to the first button of the new step, and the existing help text still announces the count.
Test: On first load only Step 1 is shown, and choosing "Anger" shows Step 2 with focus on its first button.

**R5. Selection summary near the top.** A one-line plain paragraph at the top of the Entry panel says what is selected, for example "Selected: Anger then Mad".
Test: After choosing Anger then Mad, the paragraph reads "Selected: Anger then Mad" and it sits above Step 1.

**R6. Selected state is not colour alone.** Selected buttons keep `aria-pressed` and also show a tick and a thicker border.
Test: With colours forced off, a selected button is still visibly different from an unselected one.

## 2. Record and optional questions

**R7. Record sits straight after the selection.** The "Record this emotion" button and "Reset selection" follow the steps. The optional questions move into a section after them, headed "Add detail (optional)".
Test: In tab order, Record comes before every optional question control.

**R8. Record saves at once.** Record saves the entry with the chosen emotion and the capture settings' defaults, without needing the optional questions.
Test: Choosing an emotion and pressing Record adds one log entry with the same fields as today.

**R9. Add detail saves into the same entry (Q-EW26 a).** After Record, "Add detail (optional)" is available. Saving it updates that same entry. It does not create a second entry.
Test: Record, then Add detail with a note, then the log shows one entry containing the note.

**R10. Capture settings honoured.** Questions switched off in capture settings stay hidden in Add detail, and the phases and Custom option still decide which are shown.
Test: In Phase 1 no optional questions appear, and in Phase 4 all seven do.

**R11. Focus and announcements after Record.** Focus stays on Record. One status message confirms the record, says the selection was cleared and says Add detail is available. The existing clearing of selected values after Record, Reset and Start a new entry still works.
Test: After Record the status text is announced once, focus is on the Record button, and all selections are empty.

**R12. Capture settings move.** The capture settings disclosure moves after the Record and Add detail actions, still collapsed by default, with the current phase in its summary.
Test: Capture settings are below Add detail and show "Phase N" in the summary.

## 3. Search by name

**R13. Search field.** Under the Entry heading and above Step 1 is a search form with a visible label "Find an emotion", an `input type="search"` and help text linked by `aria-describedby`.
Test: The label and help text are read when the field takes focus.

**R14. Matching.** Matching is case-insensitive, ignores accents and leading spaces, ranks word-start matches first, and covers all three levels. Names only, not descriptions (brief, out of scope).
Test: Typing "aband" returns both Abandoned entries, and typing a word from a description only returns nothing.

**R15. Full-path results with duplicates (Q-EW27 a).** Each result is a button in a list item and shows the full path, for example "Anger, then Mad, then Furious (outer level)" or "Anger (inner level)". Words that appear in more than one place show every path as its own result.
Test: "Inferior" returns two results, one under Sad then Depressed and one under Fear then Insecure.

**R16. Result limit.** The first 10 results are listed and a "Show all N results" button reveals the rest.
Test: Typing "e" lists 10 results plus a button naming the total.

**R17. Choosing a result.** Choosing a result sets the same selection as browsing, including blank lower levels for inner and middle matches, clears the search field, announces "Selected: ..." and moves focus to the next step or to Record.
Test: Choosing "Mad" under Anger selects Anger and Mad, shows Step 3, and the browse buttons show the pressed state.

**R18. Status messages.** A polite status region reports the count after a pause in typing, and "No emotions match 'xyz'" with the same text on screen when empty. Focus never moves while typing.
Test: Typing "xyz" shows and announces the no-results message and focus stays in the field.

**R19. Keyboard.** Tab and Down Arrow move from the field into the results, Up Arrow returns, Enter or Space chooses, and Escape clears the field and keeps focus there. Tab order alone is enough to use everything.
Test: A user can search, choose and record using only Tab, Enter, Space and Escape.

**R20. Target size and contrast.** Results and controls are at least 44 by 44 CSS pixels with 7 to 1 text contrast and the existing `--focus` ring.
Test: Automated contrast and target size checks pass at AAA.

## 4. Descriptions

**R21. Static data file.** Descriptions live in `assets/emotion-descriptions.js` as a `descriptions` object keyed `Inner`, `Inner|Middle` and `Inner|Middle|Outer`. They are display data only and are never written into records, backups or Drive files.
Test: A saved record, a backup file and a Drive file contain no description text.

**R22. Complete coverage.** Every inner, middle and outer path in the `emotions` array has one description, and no description exists without a matching path.
Test: A unit test comparing keys with the array reports no missing and no orphaned keys.

**R23. Approved wording only.** Only descriptions Tim has approved are shipped, written to the template in `outputs/descriptions/batch-1.md`.
Test: Every shipped description matches an entry marked approved in the batch files.

**R24. Setting "Show and read descriptions" (Q-EW28 a).** A checkbox, off by default, with a 44 pixel target. When on, a description appears under each step and in search results, and each button gets `aria-describedby` to its own description. When off, the text is hidden from view and from screen readers and `aria-describedby` is removed. The change is announced.
Test: With the box clear, no description is visible or described. After ticking it, the focused button's description is shown and described.

**R25. Setting is remembered.** The choice is stored in `localStorage` under its own key as "on" or "off" only, applied on load, and not part of the log data. If storage is blocked, the page still works and starts with descriptions off.
Test: Tick the box, reload, and the box is still ticked. Clear storage and it is off.

**R26. Panel and hover are extras.** A persistent description panel under each step shows the focused, hovered or selected button's text when the setting is on. Hover is never the only route. Touch and keyboard reach the same text.
Test: With only a keyboard, or only touch, every description can be read.

## 5. Data and compatibility (brief requirement 2)

**R27. No stored field renamed or removed.** All existing stored fields keep their names and meaning.
Test: A diff of the saved record shape before and after shows no removed or renamed field.

**R28. Any new field is optional.** A new stored field has a safe default and older code ignores it. If the schema or the Drive file format changes at all it gets a version number, a migration and Jacob's prior approval. The current `dataSchemaVersion` is 5.
Test: A record without the new field loads and displays normally, and an older build opens a record written by the new build.

**R29. Real sample round trip.** A local log, a backup file and a Drive-format file from the current version load in the new build, save again, and compare unchanged.
Test: The re-saved files match the originals except for any documented optional field.

**R30. Existing tests pass.** All nine files in `tests/` pass, `tests/google-drive-sync.cjs` is extended where needed, and a new test covers R22.
Test: The full test run exits with no failures.

## 6. Regression and compliance

**R31. Full regression (brief requirement 1).** Carol runs the checklist below in a real browser before any merge.
Test: Every checklist item is marked pass with evidence.

**R32. Accessibility gate.** WCAG 2.2 AAA with axe-core, Pa11y and code review. Heading order stays unbroken with the renamed headings.
Test: The automated checks report zero violations.

**R33. Merge gate.** The merge does not open without Carol's regression result and Jacob's data compatibility confirmation, then Tim's express approval.
Test: Both confirmations are recorded in the work log before merge.

## Feature checklist for Carol's regression

Taken from headings, buttons and tests in the current `index.html` and `tests/` folder.

1. Navigation: menu toggle, Entry, Logs, Charts, My Data, Share My Data, Data Shared with Me, Help, and footer links (Privacy, Accessibility and design, About, Licence, Contact).
2. Entry steps: pick inner, middle and outer emotion, change a choice, Reset selection, selected values cleared after Record, Reset and Start a new entry.
3. Review and record: selection summary, Record this emotion (disabled until a choice), recording at inner and middle level only.
4. Record confirmation: Undo, Record another like this, Start a new entry.
5. Optional questions: expected and actual intensity with minus and plus, intensity alignment, tags (add and select), values and character strengths, sensations (sensation guides by emotion), emotion bucket level with minus and plus, optional note.
6. Capture settings: Phases 1 to 4 and Custom, values frameworks (PersonalValu.es and VIA), rating scale change with backup first, Download backup and Connect Google and back up.
7. Share full table and Copy as HTML table for the wheel, with the copy fallback dialog (Select text, Close).
8. Logs: My emotion log list, empty state "Record your first emotion", delete with Undo delete, edit an entry, filters (tags with any or all, values with any or all, intensity alignment, and the others), Clear filters, tally, Share tally data, Copy as HTML table, Share recent entries, Copy as HTML table.
9. Context analysis and logging streak: daily congratulation message.
10. Charts: empty state, period selector with Previous and Next, Advanced filters, Most recorded tags, Values and character strengths, Emotions by tag.
11. My Data: backup download, restore from file, Saving and automatic sync, data upgrade ("Multiple values frameworks are here", Download original data backup, Connect Google and back up, update).
12. Google Drive: connect, sync summary, Extend, Reconnect, sync offer (Start syncing, Not now), Review sync issue, Disconnect, Choose which record to keep (backup conflict).
13. Share My Data and Data Shared with Me: share, shared dataset list, review dataset indicator (read only), read-only behaviour.
14. Help page, About, Privacy, Accessibility pages and theme.
15. Local storage keys and schema version unchanged, unless approved: `emotionWheelLocalLogV1`, `emotionWheelCaptureSettingsV1`, `emotionWheelLastCongratulatedDayV1`.
16. Tests that must pass: `capture-options`, `clear-entry-form`, `context-analysis`, `google-drive-sync`, `google-drive-ui`, `google-drive`, `logging-streak`, `release-readiness`, `review-datasets`, `shared-dataset-list` (all `.cjs`, ten files under `tests/`).

## Open points

1. Outer duplicates: the design note says 112 descriptions keyed by word, but also says Inferior and Inadequate need separate text per parent. Keyed by full path there are 114 entries. This file assumes one entry per path, unless Tim chooses otherwise.
2. The brief says the tests folder has nine files. The folder holds ten.
