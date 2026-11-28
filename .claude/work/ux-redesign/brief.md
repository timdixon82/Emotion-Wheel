# Brief: Entry flow redesign, emotion search and descriptions

Status: done
Tier: 2 (the app holds personal emotional records and syncs to Google Drive; build stage follows the full chain)
Mockup mode: A, static HTML prototype

## Source

Design note: `outputs/spikes/2026-11-27-ux-review.md` (Simon, 2026-11-27). Read it first.

## Decisions from Tim (2026-11-27, "a" to all)

- The team drafts the 112 emotion descriptions; Tim approves in batches.
- Add a skip link first, and prototype moving the optional questions after Record.
- Rename the "circle" headings (for example "Core feeling").
- Descriptions show in a persistent panel plus a "Show descriptions" toggle, working by keyboard, touch and screen reader. Hover is an extra, never the only route.
- Search matches emotion names only at first.
- Treat the existing page styles as the brand; `docs/brand.md` does not exist.
- Q-EW28 a: the "Show and read descriptions" setting is off by default and the app remembers the choice between visits.
- Q-EW29 b (corrects an earlier misreading of "a and a"): Carol tests the revised prototype in a real browser first, then Tim tries it with VoiceOver.
- Q-EW27 a: duplicate words at different levels both show in search, each with its full path.
- Q-EW26 a: "Add detail" saves into the same entry. Tim wrote "25a"; Sonja read it as Q-EW26, since Q-EW25 was already answered. Tim to correct if wrong.

## This stage: prototype only

Build a static HTML prototype in `outputs/prototypes/ux-redesign/` (its own `index.html` and CSS, no changes to the real app). Include: skip link, renamed headings, reordered Entry flow with optional questions after Record, the emotion search with results showing the full path, and the descriptions panel with its toggle, using placeholder descriptions for a handful of emotions.

- Q-EW31 b (against Jacob's recommendation): the Show and read descriptions setting is stored inside capture settings, so it syncs with Drive and backups. Jacob must re-confirm: the new key must be optional with a safe default, ignored safely by older versions, and must not cause false conflicts in the Drive three-way merge (assets/google-drive-sync.js line 80). This is a stored-data change, so it needs the round-trip test.
- Q-EW32 a: the descriptions panel ships only after all descriptions are approved.
- Q-EW33 a: test fixtures are generated fake samples, no real personal data.
- Q-EW34 a: one description per path, so 114.
- Q-EW35 a: Sonja reads batch 1 to Tim in groups of six for approval.
- 2026-11-28, Tim: approved release without his own VoiceOver pass on the search prototype or the build. Automated checks (axe-core, Pa11y, Carol's AAA review, regression) still apply, and the goal condition requires all tests and CI to pass before each merge. Goal: complete, test, merge and release so it is live.
- 2026-11-28, Tim answered "a" to Q-EW59 and Q-EW60 (read by Sonja as a to both): description matches open automatically only when there are three results or fewer; the "match:" cue is dropped from each result and an opened description starts with one sentence, "Description contains your search". Tim to correct if wrong.
- Screen reader review fixes to apply to the prototype and later the build: status says "25 results, showing the first 10"; add a "Skip results" link and do not rely on arrow keys; Description button named with the full path; delay the status after Show all; longer typing delay (about 800 ms); announce "Search cleared" on Escape.
- 2026-11-28, Tim, search design changes after testing the prototype: (1) matching words must be identifiable to screen reader users, not only visually highlighted; (2) compress the result paths, for example "Anger > Mad > Furious" instead of "Anger then Mad then Furious", while a screen reader still hears a clear path, not the words "greater than"; (3) searching a parent (for example Anger) shows all its sub-items (descendants); (4) no need to label results "matched by name" or "matched by description"; (5) results can be expanded, or hovered or focused, to show the description, and a result that matched on its description shows it automatically. Query "Angry" should find Anger (word stem or alias handling to be designed).
- 2026-11-28, Tim: search must also match the description text, not only emotion names. This reverses Q-EW22 a (names only first). Consequences: the search build depends on the descriptions data file, so Jacob's pull request order must change (descriptions file before search); the prototype needs updating; the completeness test for descriptions matters more, since search quality depends on it.

## Non-negotiable requirements for the build (added by Tim, 2026-11-27)

1. **Full functionality regression.** Every existing feature must still work after the change: recording, editing, undo, reset, tags, values, sensations, bucket level, intensities, log filters and tallies, charts, backups and restore, Google Drive save and sync, settings, the help and info pages. Carol runs a full regression against a feature checklist taken from the current app, in a real browser, before any merge. The existing tests in `tests/` must all keep passing.
2. **Data retained across versions.** Records saved locally, in backup files and in Google Drive must load, display, sync and re-save unchanged after the update, and records written by the new version must still be readable by older versions where practical. Rules:
   - No renaming or removal of stored fields (inner, middle, outer, level, tags, values and the rest). Heading renames are display text only.
   - Emotion descriptions are static display data. They are never written into saved records, backups or Drive files.
   - Any new stored field is optional, has a safe default, and is ignored safely by older code.
   - If the data schema or Drive file format changes at all, it needs a version number and a migration, and Jacob must approve it first.
   - Test with real sample files from the current version: a local log, a backup file and a Drive-format file, loaded into the new build, and the round trip saved again and compared. The existing `tests/google-drive-sync.cjs` must keep passing and be extended if needed.
3. These two requirements are part of the definition of done, and the merge gate does not open without Carol's regression result and Jacob's confirmation of data compatibility.

## Out of scope

Changes to the real `index.html`, writing all 112 descriptions, Google Drive sync, capture settings logic, search of descriptions.

## Risk and rollback

Prototype is outside the app, so nothing ships. Rollback is deleting the folder.

## Definition of done

- Prototype opens from a file with no server and no network calls.
- WCAG 2.2 AAA: keyboard only, 7:1 contrast, visible focus, no information by colour alone.
- A short README in the folder describing each feature and how to try it by keyboard.
- Handoff envelope returned, under 300 words.
- Next stage: contrast-master and screen-reader-lab check the prototype, then Tim reacts, then Tad drafts descriptions and Sean builds.
