# Handoff: 2026-11-28

## Tim-facing tasks

None.

## Active work folders

None.

## Blocked work folders

(not available in this repository)

## Open questions

None.

## Open pull requests

None.

## Overdue tasks

None.

## Notes

- Released 1.11.0 (tag v1.11.0, live): emotion search by name and description, descriptions for all 114 emotions with a synced Show and read descriptions setting, renamed step headings, skip links, Record before Add detail (same entry), values clear after save. No saved data format change (schema 5). Work folder .claude/work/ux-redesign/ holds the brief, requirements and architecture.
- Open: seven new tests (data-round-trip, clear-entry-form, step-headings, emotion-descriptions, emotion-search, descriptions-panel, record-before-detail) are not run by CI because ci.yml is protected. Q-EW62 needs Tim's approval to add them.
- Open: Q-EW63, reword log, tally and filter labels still saying Inner, Middle and Outer circle with a display mapping. Phase 1 still shows the Note box in Add detail (as before); steps 2 and 3 always show and the Selected summary is not at the top (R4, R5 follow-ups).
- Follow-ups: long "Use X to prepare" table row button labels; stale-entry guard on Save detail; clear Save detail timer on edit and Reset; Drive tag test order; meta description on the live page; delete untracked .playwright-mcp/ folder.
- Team master, from a team-root session: command gate hardening (MCP repository scope, git -C realpath, commit on main), exact adm-zip and basic-ftp pins in the template; then re-sync this project.
- Tim can clear merged local branches with scripts/tidy-branches.sh.
