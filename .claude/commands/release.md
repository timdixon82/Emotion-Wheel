---
description: Run the release readiness check and the merge gate
allowed-tools: Read, Write, Bash, Agent
---

Prepare a release for the current project.

1. Dispatch Carol for release readiness, including the release checklist: verify each item, that the continuous integration, accessibility, and security checks have passed; that Carol has signed off functional, accessibility, and visual testing; that the architecture-and-security conformance check is done; and that the version and changelog are ready.
2. When Carol reports, run the merge gate from Sonja's CORE. If any gate item fails, route it back through the team and stop.
3. When the gate is satisfied, present the release to Tim with a clear summary, and ask for his express approval.
4. Merge only after Tim approves. Sonja is the only agent who merges, and a merge is never pre-approved.
