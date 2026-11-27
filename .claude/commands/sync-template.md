---
description: Sync CORE sections from the agent team template
allowed-tools: Read, Edit, Bash, Agent
---

Update this project's agent files with the latest CORE sections from the template repository.

1. Always do the sync on one stable branch: `chore/template-sync`. Never name the branch after the template version, and never invent a new name per run. If the branch already exists, check it out and reuse it; if not, create it. One stable branch means each repository holds at most one sync branch at a time, and a new sync updates the existing pull request instead of leaving a trail of version-named branches behind. This is a deliberate anti-clutter rule; see `docs/release-process.md` under "Post-merge branch cleanup" for why.
2. Run the team repository's copy of the sync script against this project, never this project's own copy of `scripts/sync-from-template.sh`: `bash "<master path>/scripts/sync-from-template.sh" "<master path>" "<this project's path>"`. A project's older copy has no check for the ci-tools folder move and could copy workflows that point at folders the project does not have. For the whole fleet, use `scripts/sync-all-projects.sh` from the team repository. If the master copy does not exist, tell Tim and stop.
3. The sync replaces only the content between the `<!-- BEGIN CORE -->` and `<!-- END CORE -->` markers in each agent file. It never touches the PROJECT OVERLAY section, so project-specific customisations are safe.
4. Show Tim a clear summary of what changed in each agent file.
5. Open or update the pull request from `chore/template-sync`. If an open sync pull request already exists, push to its branch so it updates in place rather than opening a second one. Opening a pull request is a GitHub action: pre-approve it in the brief, or get Tim's approval at the time.
