# Emotion Wheel - Tracking your emotions

Emotion Wheel is an accessible, single-page tool for recording and reflecting on emotions in your own browser. It is designed to make everyday entry simple while providing richer review tools when you want to spot patterns.

Open `index.html` in a modern browser, or use the GitHub Pages site once published.

## What it does

- Record an emotion from the inner, middle, or outer level of the wheel. You never need to complete every level before recording.
- Start with Phase 1 for simple habit-building, move to Phase 2 for guided reflection, or use Custom to choose the fields that suit you.
- Add an optional private note to each entry, such as what happened, a thought, or useful context.
- See the active capture mode without opening settings, and use the compact mobile recording action without adding a duplicate screen-reader control.
- Keep entry, review, and maintenance separate with keyboard-accessible tabs.
- Review logs, tallies, charts, and a line chart of records over time.
- Move through chart periods by day, week, or month. Zero-entry periods can be included to show gaps in the pattern.
- Compare inner-circle emotion trends and choose which colour-coded series to display.
- Correct entries, use an existing entry as the start of a new one, or delete with an immediate undo option.
- Save, load, merge, replace, share, export, and clear your local data.

## Privacy

Your entries, optional notes, and settings are stored only in local storage in the browser on the device you are using. The app has no server and does not send data anywhere.

Data only leaves the browser when you deliberately export a CSV or JSON backup, share a chart or table, or copy information. Browser data can be cleared by clearing the log in Maintenance, clearing the browser's site data, or using a different browser or device.

Read the fuller [privacy notes](docs/privacy.html) before using this for sensitive information.

## Getting started

1. Open the Entry tab.
2. Choose Phase 1, Phase 2, or Custom in Capture settings if you want to change the recording fields.
3. Select an emotion at any level and add an optional note if helpful.
4. Select **Record this emotion**.
5. After saving, undo the entry, prepare another like it, or start a clean entry.
6. Open Review when you want to see logs and charts, or Maintenance when you want to export, back up, load, or clear data.

Phase 1 is recommended for at least one week to build the recording habit. Phase 2 then adds optional questions about appropriateness, expected and actual intensity, intensity alignment, and physical sensations.

## Design and themes

The interface follows Tim Dixon's design system: Roboto type, navy card hierarchy, accessible tables, 44-pixel minimum control targets, and four colour modes.

- Light
- Dark
- Muted Light
- Muted Dark

Choose a theme from the top-right control. The preference is saved locally in the browser. The two muted themes are intended for people who prefer a calmer, lower-saturation experience.

The rendered design and accessibility notes are in [docs/accessibility.html](docs/accessibility.html), with the source notes in [docs/design-system.md](docs/design-system.md).

## Accessibility

- A skip link takes keyboard and screen reader users directly to the main content.
- Workspace and review tabs support Arrow Left, Arrow Right, Home, and End.
- Secondary content uses native collapsed sections, reducing noise while keeping every feature reachable by keyboard.
- Focus follows the visible entry sequence: emotion levels, optional reflection fields, optional note, then Record.
- Mobile recording uses the same Record control in a sticky action area, avoiding duplicated controls for screen readers.
- The wheel has a text-based selector and a full reference table.
- Charts have plain-language summaries, accessible line or bar visuals, and matching data tables.
- Tables have captions and column headings, and wide tables remain horizontally scrollable on smaller screens.
- Focus indicators and controls work in every colour mode.

## Data and backups

All entries, including optional notes, are included in JSON backups and full-log CSV exports. Loading a backup can either merge new records into the current log or replace it after confirmation. Older backups without notes remain valid.

## Development

This is a static HTML, CSS, and JavaScript app. There is no build step.

- Open `index.html` in a browser for a quick local check.
- Use the HTML validator and JavaScript syntax check configured in `.github/lint-tools` when available.
- The GitHub Actions workflows provide additional continuous integration checks.
- Follow [the release guide](docs/releasing.md) and bump the application version for every release.

## Licence

This project is available under the [MIT Licence](LICENSE).
