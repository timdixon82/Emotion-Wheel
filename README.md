# Emotion Wheel Selector and Local Log

An accessible, single-page emotion wheel tool for identifying and logging emotions locally in your browser.

Open `index.html` in a browser, or use the GitHub Pages site once published.

## Privacy

Emotion entries are stored only in the browser on the current device using local storage. Nothing is sent to a server.

## Change in this version

The emotion list now uses the manually verified 72-path dataset. The full emotion table is generated from the same dataset as the selector, so the table and buttons stay in sync.

The review, record, and reset controls now appear after the three emotion selection steps. This gives a cleaner flow:

1. Choose inner-circle emotion.
2. Choose middle-circle emotion.
3. Choose outer-circle emotion.
4. Review and record, or reset.

## Features

- View a visual emotion wheel before using the selector.
- Select emotions one layer at a time.
- Record the selected emotion locally with date and time.
- Store entries only in the browser on the current device using local storage.
- Display a live tally table showing each emotion path and number of times felt.
- Display recent logged entries.
- Export the tally as CSV.
- Export the full dated log as CSV.
- Clear the local log.

## Keyboard use

- Tab and Shift+Tab move between controls.
- Enter or Space selects an emotion or activates a button.
- After choosing an outer-circle emotion, focus moves to the Record button.

## Screen reader notes

- A skip link lets keyboard and screen reader users move directly to the main content.
- The wheel image is introduced as a visual reference; the selector and full table provide text access to the same workflow.
- Native buttons are used for all selections.
- Selection button groups are labelled by step and include helper text where choices depend on an earlier step.
- Headings separate each step.
- A live region announces the current selection and recording actions.
- Tables use captions and column headers.
