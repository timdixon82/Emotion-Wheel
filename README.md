# Emotion Wheel Selector and Local Log

An accessible, single-page emotion wheel tool for identifying and logging emotions locally in your browser.

Open `index.html` in a browser, or use the GitHub Pages site once published.

## Privacy

Emotion entries are stored only in the browser on the current device using local storage. Nothing is sent to a server.

## Change in this version

The selector now supports configurable capture stages.

Phase 1 records the selected emotion at any level: inner circle, middle circle, or outer circle. The person does not need to complete all three steps before recording.

Phase 2 adds optional reflection fields:

1. Whether the emotion feels appropriate.
2. Expected intensity from 1 to 10.
3. Actual intensity from 1 to 10.
4. An alignment result comparing expected and actual intensity.
5. Optional physical sensation checkboxes suggested from the selected emotion type.

Use Phase 1 or Phase 2 for the common journeys, or choose Custom to turn individual fields on and off.

## Features

- Jump between the main page sections from the top menu.
- View a visual emotion wheel before using the selector.
- Select emotions one layer at a time.
- Record the selected emotion locally with date and time after any selected layer.
- Choose Phase 1, Phase 2, or Custom capture fields.
- Capture whether the emotion is appropriate.
- Capture expected and actual intensity, with an alignment result.
- Select optional physical sensations suggested by emotion type, or show more sensations when a broader list would help.
- Store entries only in the browser on the current device using local storage.
- Display a live tally table showing each emotion path and number of times felt.
- Display recent logged entries.
- Share table data from the tally, recent entries, and full emotion table using the native share sheet where the browser supports it.
- Fall back to automatic clipboard copy when native sharing is not available.
- Copy table data as HTML tables for pasting into rich text editors, with a second browser selection-copy method for browsers that block rich clipboard writes.
- Show a manual copy panel only when the browser blocks every automatic share and copy method.
- Export the tally as CSV.
- Export the full dated log as CSV.
- Clear the local log.

## Keyboard use

- Tab and Shift+Tab move between controls.
- Enter or Space selects an emotion or activates a button.
- After choosing an emotion at any level, focus moves to the Record button.

## Screen reader notes

- A skip link lets keyboard and screen reader users move directly to the main content.
- The wheel image is introduced as a visual reference; the selector and full table provide text access to the same workflow.
- Native buttons are used for all selections.
- Native checkboxes, radio buttons, and range inputs are used for optional capture fields.
- Selection button groups are labelled by step and include helper text where choices depend on an earlier step.
- Headings separate each step.
- Live regions announce the current selection, intensity alignment, and recording actions.
- Tables use captions and column headers.
