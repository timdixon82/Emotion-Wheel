# Brief: clear values on save

Status: done
Tier: 1 (rated by Sonja; the app holds personal emotional records, so tier-suggest.sh must be run once the branch has commits and the tier raised if it says so)
Mockup mode: not applicable

## Problem

In `index.html`, `clearEntryForm()` (near line 2274) clears every entry field except the values checkboxes in `valuesButtons`. `renderValues()` then redraws using whatever is still ticked, so selected values carry over into the next entry after Record, after "Reset selection" and after "Start a new entry". Found by reading the code only; not yet reproduced in a browser.

## Task

1. Reproduce the bug with a test in `tests/` (follow the existing `.cjs` test style).
2. Fix it so all three paths clear the values: after Record, Reset selection and Start a new entry.
3. Do not break edit mode: `prepareEntry()` must still load an entry's saved values.
4. Check the other fields while there: confirm by test that tags, sensations, bucket level, appropriate response, both intensities, note and new tag name are cleared on all three paths. Also check whether the intensity alignment text refreshes after a save. Fix any other gap found, and list it in the handoff.

## Out of scope

The UX redesign, search, emotion descriptions, any change to capture settings or to Google Drive sync, and the template hook files.

## Risk and rollback

Low risk, small front-end change. Rollback is reverting one commit. The change touches entry handling for personal data, but adds no new data collection or storage.

## Definition of done

- A failing test first, then passing after the fix.
- The existing tests and the accessibility regression suite pass.
- Work on a branch named `fix/clear-values-on-save`, one pull request opened, never merged by Sean.
- Handoff envelope returned, under 300 words, including the commands run and results.
- No em dashes, plain language in any user-facing text.

## Decisions recorded

Tim answered "a" to all seven questions on 2026-11-27, read by Sonja as the recommended option each time, including "fix the values bug now as a separate Tier 1 fix".
