---
description: Run a wiki health check
argument-hint: [tier: global, project, or both]
allowed-tools: Read, Glob, Grep
---

Run a wiki lint, a health check on the wiki.

1. Take the tier from `$ARGUMENTS`. The default is both tiers.
2. Check for: contradictions between pages, stale claims that newer sources have superseded, orphan pages with no inbound links, important concepts that are mentioned but lack their own page, missing cross-references, and data gaps that a research pass could fill.
3. Also check whether any global wiki entry has become project-specific, or any project wiki entry is really cross-cutting.
4. Report the findings to Tim as a clear list, and propose a fix for each one. Do not change the wiki until Tim approves the fixes.
