---
description: Declare an incident and open an incident folder
argument-hint: [short-description]
allowed-tools: Read, Write
---

Declare an incident.

1. Take a short description from `$ARGUMENTS`, or ask Tim for one.
2. Create `.claude/work/incident-<YYYY-MM-DD>/` with an `incident.md` that records the time, what is wrong, the suspected cause, the impact, and the immediate actions taken.
3. Write that incident folder's name to `.claude/work/.current`.
4. Work the incident with the systematic-debugging approach. Find the cause before proposing a fix; do not guess.
5. Keep `incident.md` updated as the incident is worked. When it closes, write a short resolution and the lesson learned. If the lesson is cross-cutting, flag it for a wiki ingest.
