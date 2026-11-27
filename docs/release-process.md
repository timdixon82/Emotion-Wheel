# Release process: Emotion-Wheel

This document records the release process for Emotion-Wheel. It is produced during the project setup pass and updated whenever the process changes.

## Branching model

Not yet confirmed for this project. The team default is: `main` is the production branch; feature work happens on short-lived branches; no long-lived development branches unless the project has a specific reason.

## Pull-request flow

Describe the steps a change goes through before it reaches `main`. The team default:

1. Open a pull request from a feature branch to `main`.
2. Continuous integration checks pass (linting, accessibility, security, tests).
3. Carol signs off functional, accessibility, and visual testing.
4. Sonja reviews for architecture and security conformance.
5. Tim gives express approval to merge.
6. Sonja merges.

## Merge gate

List the conditions that must hold before Sonja merges. The team default:

- All required CI checks pass.
- Carol has signed off.
- The architecture-and-security conformance check has passed.
- Tim has given express approval.

## Project release facts

From `releasing.md`, the existing release guide:

- Version source of truth: `APP_VERSION` in `assets/version.js`, shown in the footer.
- Releases are made by a manual Git tag `vX.Y.Z` that matches `APP_VERSION`. The `version.yml` workflow rejects a tag that does not match, or when `node tests/release-readiness.cjs` or the backwards-compatibility tests fail.
- Publishing: `deploy.yml` publishes to GitHub Pages using `.github/deploy-publish.txt`. Only `/index.html`, `/CNAME`, `/assets/` and `/pages/` are published. No `.md` file, `docs/`, `CLAUDE.md` or `.claude/` reaches the live site.
- `release.yml` (release-please) and `playwright.yml` are not used for this project.
- Branch protection and required checks: TO BE CONFIRMED by Tim (not verifiable from the repository).

## Release steps

Follow `releasing.md` step by step. A merge to `main` publishes through `deploy.yml`.
