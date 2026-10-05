# Design system

Emotion Wheel follows Tim Dixon's design system as its visual and interaction foundation.

## Principles

- Four themes: Light, Dark, Muted Light, and Muted Dark.
- Roboto type with system-font fallbacks.
- Navy navigation, clear card boundaries, flat surfaces, and generous spacing.
- Strong visible focus indicators and controls sized for touch and keyboard use.
- Charts always include a written summary, a visible key and a data table. Shared chart images capture the displayed key.
- Colour is never the only way information is communicated.
- Hidden controls are removed from both the visual layout and accessibility tree.
- Entry focus follows the visible sequence, reset returns to the Step 1 heading, and one in-flow Record control is used across desktop and mobile layouts.
- Logs, Charts, and My Data disclose all of their sections when opened. Dense log data scrolls horizontally and remains filterable instead of wrapping into cramped columns.
- Destructive entry actions provide an immediate undo path.

## Local adaptations

Emotion Wheel keeps its own name, emotion-wheel artwork, privacy wording, and local-first data model with optional Google Drive saving and sync. It uses the design system to make the recording, review, and My Data journey consistent and easier to navigate.

On smaller screens, the header navigation collapses into a Menu button containing Entry, Logs, Charts, My Data, Data Shared with Me, Help, the data-set selector, Sync status and the theme selector. Wider screens use compact navigation and the same destinations. Entry actions remain in document flow after the always-visible optional note, so visual position and screen-reader order agree. Tables become labelled row cards instead of forcing horizontal scrolling. Chart period controls expose only the picker relevant to the selected day, week, or month view.
