---
description: Scaffold a new project from the team template
argument-hint: [project-name]
allowed-tools: Read, Write, Edit, Bash
---

Scaffold a new project from the agent team template. Sonja runs this with Tim.

0. Confirm the location first. A new repository is only ever scaffolded from the agent team root (the directory whose `CLAUDE.md` says "eight-agent Claude Code team", normally `/Users/timdixon/Code/AgentTeam`). Check `$CLAUDE_PROJECT_DIR`: if the current session is running inside a project repository rather than the team root, do not scaffold here. Tell Tim, in one line, that a new repository must be created from a team-root session, and give him the exact prompt to start one:

   > Start a new Claude session in `/Users/timdixon/Code/AgentTeam`, then say: "Create a new project called <name>".

   Stop until Tim confirms he is in a team-root session. Only when the session is at the team root do you continue to step 1.

1. Take the project name from `$ARGUMENTS`, or ask Tim for it.
2. Ask Tim, with the questions batched together: the stack (a static front-end, PHP with MariaDB, or WordPress); the hosting target; and the repository visibility. Remember that a static project on GitHub Pages needs a public repository.
3. If `scripts/scaffold.sh` exists, run it with Tim's answers. Otherwise tell Tim that the GitHub scaffold script arrives in Stage 6 of the build, and stop.
4. Copy `templates/project-docs/` into the new project as its `docs/` project wiki, and stamp the project name into the project wiki's `index.md`.
5. Record the new project in the projects registry.
6. Creating the GitHub repository is a GitHub action: it must be pre-approved in a brief, or approved by Tim at the time. Set the repository visibility correctly at creation; it can never be changed afterwards.
7. Immediately after the repository is created, enable auto-delete of merged branches by running:
   `gh api repos/timdixon82/<repo-name> --method PATCH --field delete_branch_on_merge=true`
   This keeps the repository clean: merged branches are removed automatically by GitHub. It does not affect open branches or git history.
