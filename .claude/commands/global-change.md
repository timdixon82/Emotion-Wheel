---
description: Produce a ready-to-paste prompt for making a global team change from a team-root session
argument-hint: [the change Tim asked for]
allowed-tools: Read, Grep, Glob
---

A project session cannot safely edit the team master, because the next sync would undo any edit to a CORE block here. Give Tim this prompt in a fenced block, with the specifics of `$ARGUMENTS` filled in: the exact file or agent, the CORE section affected, and the new behaviour or wording.

```
In this agent team session, make the following GLOBAL change to the team master, then prepare a sync:

<precise description of the change>

Steps:
1. Make the change in the relevant CORE block, hook, script or template under the team root.
2. Bump VERSION if the change affects scaffolded config (agents, hooks, settings, commands).
3. Run `bash scripts/sync-all-projects.sh` and report per project what changed.
4. Opening a pull request in each changed project is a gated action: pause for Tim's approval.
```

Then tell Tim in one line to start a session at `/Users/timdixon/Code/AgentTeam` and paste it.
