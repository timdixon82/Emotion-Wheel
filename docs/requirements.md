# Requirements: Emotion-Wheel

This document records the requirements for Emotion-Wheel. It is produced during the Tad (business analyst) pass and is the contract that the architect, developer, and tester work from.

## Background

Describe why this project exists and what problem it solves.

## User stories

List user stories in the form "As a [user], I want [goal] so that [reason]." Number each one.

## Functional requirements

List each functional requirement as a numbered statement. Group by area where useful.

## Non-functional requirements

### Accessibility

WCAG 2.2 AAA conformance. Refer to the team's global `accessibility.md` and the project's `docs/accessibility.md` for specifics.

### Security

OWASP Top 10 mitigations applied. No paid third-party CI tokens; all scanning uses free, self-contained tooling (for example, `semgrep scan --config p/default --error`, not `semgrep ci`). Refer to the team's global `coding-standards.md` for the full security baseline.

### Performance

Record any specific performance targets here.

### Data protection

Record any UK GDPR obligations here. If the project handles no personal data, state that explicitly.

## Out of scope

List anything explicitly not required in this phase.

## Definition of done

List the criteria that must hold before this project is considered complete and ready for release.
