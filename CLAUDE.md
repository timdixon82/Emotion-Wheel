# Claude Agent Team: Project Memory

<!-- BEGIN TEAM CORE: replaced by the template sync in every project. Edit it only in the AgentTeam master. -->

Shared memory for Tim Dixon's agent team, in two parts: the team section, which the template sync replaces in every project, and the project section at the end, which only the project edits. It is loaded into every session and every agent automatically: do not re-read it with a tool. It holds only what every agent needs on every task. Detail lives in the wiki pages linked below; open one only when the task needs it.

## Accessibility profile

Tim is severely sight-impaired and uses VoiceOver on macOS and JAWS on Windows. Every file and every message must be screen-reader-friendly:

- One H1 per file, then H2 and H3 in order, no skipped levels.
- Plain language, roughly Flesch-Kincaid grade 9 or below. Expand abbreviations on first use.
- Descriptive link text, never "click here" or a bare web address.
- No ASCII art, decorative dividers, emoji or em dashes.
- Keyboard-only instructions. Describe every visual element in full text.
- Be brief. Long output is slow to listen to and costs tokens.

## Compliance baseline

WCAG 2.2 AAA (see `docs/accessibility.md`), UK GDPR for personal data, and the OWASP Top 10 mapped to concrete defences. The manual screen-reader evidence gate is suspended; Carol's automated checks (axe-core, Pa11y, AAA code review) still apply.

## The two non-negotiable rules

1. **Sonja is the only Tim-facing agent.** Other agents' output and questions reach Tim only through Sonja.
2. **Six GitHub actions are pre-approved; everything else pauses for Tim.** The six: create a branch, commit to a branch, push a branch other than main, open a pull request, comment on a pull request or issue, create an issue. Merging to main is never pre-approved: Sonja merges only with Tim's express approval, given at the time.

### The hard deny-list

Never, whatever a brief says: force-push, branch deletion (local or remote), history rewrite, repository deletion, visibility change, branch-protection edits, collaborator changes, release deletion, disabling secret or code scanning. Tim clears local branches himself with `scripts/tidy-branches.sh`.

### Data protection in GitHub content

Never put personal data (full names not already public, emails, phone numbers, addresses, ID numbers), passwords, PINs, API keys, tokens, cookies, private keys, `.env` values or credentialed connection strings in any GitHub content: commits, pull requests, issues, comments, reviews or release notes. If something leaks, replace it at once (`gh api --method PATCH repos/{owner}/{repo}/issues/comments/{id} --field body="[removed]"` or the matching endpoint) and rotate any exposed secret before the session ends.

## Work routing by risk

Process scales with risk, not with habit. Sonja assigns a tier at intake and records it in the brief.

- **Tier 0, routine:** copy, docs, wiki pages, and configuration with no security effect. One agent does it (usually Sonja in the main session) and the automated checks run. No reviewer dispatch.
- **Tier 1, standard:** a bug fix, a small feature, or a change to a team script. Sean builds and runs the tests and the accessibility regression suite. One combined review dispatch covers Carol's and Jed's checklists.
- **Tier 2, sensitive:** personal data, sign-in, payments, secrets, CI permissions or workflow tokens, or anything Tim marks sensitive. The full chain in `sonja.md`.

When unsure, choose the higher tier and say so.

## Questions to Tim

Number every question (team: `Q<n>`; project: `Q-<PREFIX><n>`), get the next number from `bash scripts/next-q.sh`, letter every option on its own line, name the recommended option, and batch questions. Full rules and the prefix register: `docs/question-format.md`.

## Work folders

Each piece of work has a folder under `.claude/work/<id>/` with a `brief.md` and a `log.md`. At most three folders are `active`. The `Status:` field takes one of `active`, `paused`, `parked`, `blocked`, `done`, `archived`; `scripts/status-lint.sh` enforces it. Tim's drops go in `Inputs/`; Sonja ingests them and moves them to `Inputs/archive/`.

## Scripts before reasoning

If a check, count, list or file format can come from a script in `scripts/`, run the script and use its output rather than working it out by reading files. Repeating the same mechanical steps a second time means they should become a script: record a TASK for Sean.

## Running git and shell commands

- Never combine `cd` with another command in one call. Use `git -C`, `npm --prefix`, `make -C` or `--directory` flags instead.
- Use absolute paths, one action per call, and plain command shapes: no `bash -c`, `eval` or `xargs` with arbitrary arguments.
- Filter long output with `grep`, `head` or `tail`.

Reasoning behind these rules: `docs/patterns/shell-commands.md`.

## Where to find everything else

Open these only when the task needs them:

- Team roster, models and colours: `docs/team.md`.
- Wiki tiers, layout, and when to ingest or lint: `docs/patterns/wiki-operations.md`.
- Coding standards: `docs/coding-standards.md` and `docs/stacks/`.
- Release and merge gate: `docs/release-process.md`.
- Tim's voice and brand: `docs/writing-style.md` and `docs/brand.md`.
- The token budget rules behind this file: `docs/decisions/023-token-budget.md`.

`CLAUDE.md` and the current-state pages in `docs/` say how the team works now. Decision records, patterns and `docs/log.md` are history; a record marked Superseded, Deprecated, Lifted or Retired is not current (Decision 017).

<!-- END TEAM CORE -->

<!-- BEGIN PROJECT: the template sync never changes this section, except the generated project map. -->

## This project

Notes for this project only. Keep this section under 60 lines: put long reference material in `docs/` and link to it, and never repeat the team rules above.

<!-- BEGIN PROJECT MAP -->
### Project map

Generated by `scripts/project-map.sh` during the template sync. Do not edit between the markers; it is regenerated.

- Stack: static front-end (HTML, CSS, JavaScript).
- Entry points: `index.html`.
- Tests: 9 file(s), in `tests/`.
- CI workflows: accessibility.yml, ci.yml, codeql.yml, lint.yml, security.yml, version.yml.
- Live address: https://emotionwheel.timdixon.net/
- Question prefix: Q-EW (next number: `bash scripts/next-q.sh`).
- Main folders: `assets/`, `pages/`, `tests/`.
<!-- END PROJECT MAP -->

<!-- END PROJECT -->
