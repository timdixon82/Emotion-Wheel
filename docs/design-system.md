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
- Entry focus follows the visible sequence and uses one Record control across desktop and sticky mobile layouts.
- Destructive entry actions provide an immediate undo path.

## Local adaptations

Emotion Wheel keeps its own name, emotion-wheel artwork, privacy wording, and local-only data model. It uses the design system to make the recording, review, and maintenance journey consistent and easier to navigate.

On smaller screens, the header navigation collapses into a Menu button containing Entry, the grouped Review destinations, Maintenance, and the theme selector. On wider screens Entry, Logs, Charts, and Maintenance form one flat row, with the theme selector at the top right. Selected entry actions stay reachable at the bottom of the viewport. Tables become labelled row cards instead of forcing horizontal scrolling. Chart period controls expose only the picker relevant to the selected day, week, or month view.
