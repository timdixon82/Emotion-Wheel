---
description: Scaffold a new work folder with a brief
argument-hint: [work-id]
allowed-tools: Read, Write, Bash
---

Create a new work folder for the agent team.

1. Take the work id from `$ARGUMENTS`. If it is empty, ask Tim for a short, hyphenated id, for example `fix-login-bug`, and stop until he gives one.
2. Create the folder `.claude/work/<id>/`.
3. If `templates/brief.md` exists, copy it to `.claude/work/<id>/brief.md`. Otherwise create `brief.md` with these sections: Summary, Requirements link, Routing plan, Approved GitHub actions as an empty checklist, and a "Not pre-approved" footer that names the hard deny-list from `CLAUDE.md`. The fallback checklist must use the same six fixed phrases as the template ("Create a branch", "Commit to a branch", "Push a branch other than the main branch", "Open a pull request", "Comment on a pull request or an issue", "Create an issue"), because the safety hook matches those phrases exactly.
4. Create `.claude/work/<id>/log.md` with the heading `# Work log`.
5. Create `.claude/work/<id>/tasks.md` from `templates/tasks.md` if the template exists, otherwise create it with the heading `# Tasks: <id>` and the short instruction paragraph (see docs/patterns/task-substrate.md for the canonical text).
6. Write `<id>` to `.claude/work/.current`, so the hooks know which work folder is active.
7. Set the brief's pre-approvals with Tim. Put one batched question to him that lists all six pre-approvable GitHub actions, each with a one-line definition of what ticking it permits, and ask which to pre-approve. Treat it as yes or no for each action: Tim names every action he wants pre-approved, and any action he does not name stays unticked, so it pauses for him each time it is needed. The six actions and their definitions are:
   - **Create a branch**: agents may create a new branch, other than the main branch, without pausing.
   - **Commit to a branch**: agents may commit changes to a branch without pausing.
   - **Push a branch other than the main branch**: agents may push a non-main branch to GitHub without pausing. Pushing to the main branch is never pre-approved.
   - **Open a pull request**: agents may open a pull request without pausing.
   - **Comment on a pull request or an issue**: agents may post a comment on a pull request or an issue without pausing.
   - **Create an issue**: agents may open a new GitHub issue without pausing.
   Tick only the boxes Tim approves, and leave the rest unticked. Never tick a box he has not approved. The six phrases are fixed, because the safety hook matches them exactly: do not reword them or add lines.
8. Tell Tim the work folder is ready, state which actions you pre-approved, and ask him to fill in the brief's Summary and the other required sections.
