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

- Released 1.11.2 (tag v1.11.2, live, GitHub Releases for 1.11.0, 1.11.1 and 1.11.2 created). Search by name and description, descriptions for all 114 emotions, Capture settings at the top with the Show and read descriptions tickbox inside it, Main feeling, More specific feeling and Most specific feeling labels (display only, CSV too). No saved data format change (schema 5). Old file types checked by Carol in a real browser.
- Unreleased on main: version query on every local script (PR 42), project map refresh (PR 41). Ships with the next release.
- CI: npm test now runs all 17 test files; ci.yml untouched. Gitleaks ignores one public Drive picker browser key (.gitleaksignore). Tim checked its Google Cloud limits.
- Open follow-ups: long "Use X to prepare" table row button labels; stale-entry guard on Save detail; clear Save detail timer on edit and Reset; Drive tag test order; Phase 1 still shows the Note box in Add detail; steps 2 and 3 always show and the Selected summary is not at the top (R4, R5).
- Team master, from a team-root session: command gate hardening, exact adm-zip and basic-ftp pins in the template; then re-sync this project (template 1.15.1 applied, master 1.15.2).
- Tim can clear merged local branches with scripts/tidy-branches.sh.
