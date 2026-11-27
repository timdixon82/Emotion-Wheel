# Project Coding Standards: Emotion-Wheel

This project follows the team's stack-independent standards in the global wiki's `coding-standards.md`, and the per-stack standards in the global wiki's `stacks/`.

This page records only what is specific to Emotion-Wheel: its stack, and any project-specific coding decisions.

## Stack

Static front-end (`.claude/project-type` is `web-static`), hosted on GitHub Pages with a custom domain (the `CNAME` file). The app has no build step and no runtime dependencies. Root `package.json` is a tooling manifest only.

Checks and tests:

- Unit tests: nine dependency-free Node scripts in `tests/*.cjs`, run one by one as `node tests/<name>.cjs` (the list is in `.github/workflows/ci.yml`).
- Lint: `npm run lint` (runs `ci-tools/lint.sh`, which validates HTML and CSS).
- Accessibility: axe and Pa11y from `ci-tools/accessibility-tools`, run in CI.
- Publish list check: `bash .github/scripts/deploy-publish.sh check`.

## Project-specific notes

- Public pages live in `pages/`. `docs/` holds notes and this wiki and is never published.
- Never commit `assets/google-drive-config.local.json`; the publish list excludes it.
