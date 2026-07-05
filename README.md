# Emotion Wheel Selector and Local Log

An accessible, single-page emotion wheel tool for identifying and logging emotions locally in your browser.

Open `index.html` in a browser, or use the GitHub Pages site once published.

## Privacy

Emotion entries are stored only in the browser on the current device using local storage. Nothing is sent to a server.

## Change in this version

The review, record, and reset controls now appear after the three emotion selection steps. This gives a cleaner flow:

1. Choose inner-circle emotion.
2. Choose middle-circle emotion.
3. Choose outer-circle emotion.
4. Review and record, or reset.

## Features

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

- Native buttons are used for all selections.
- Headings separate each step.
- A live region announces the current selection and recording actions.
- Tables use captions and column headers.
