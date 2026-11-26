---
description: Run a wiki ingest pass
argument-hint: [topic or work folder]
allowed-tools: Read, Write, Edit, Glob, Grep
---

Run a wiki ingest, integrating something the team has learned.

1. Take the topic or work folder from `$ARGUMENTS`.
2. Apply the ingest test in `docs/patterns/wiki-operations.md`: would a future agent act differently because of this? If not, tell Tim in one line that no ingest is needed, and stop.
3. Decide the tier. The default is project-specific. A lesson every future project needs goes in the global wiki once, and the project wiki links to it rather than copying it.
4. Update only the pages that change, plus `index.md` for any new page.
5. Append a one-line log entry: `## [YYYY-MM-DD] ingest | <subject>` followed by one sentence and a link.
6. Tell Tim in one line which tier you wrote to, and why.
