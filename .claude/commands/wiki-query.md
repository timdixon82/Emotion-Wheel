---
description: Answer a question from the wiki
argument-hint: [question]
allowed-tools: Read, Glob, Grep, WebSearch, WebFetch
---

Answer a question by searching the wiki first.

1. Take the question from `$ARGUMENTS`.
2. Search the relevant wiki: the project wiki if the work is inside a project, the global wiki otherwise, and both if the question spans them. Use `index.md` to find the relevant pages.
3. If the wiki answers the question, answer Tim, with citations to the wiki pages.
4. If the wiki is incomplete, answer from fresh research, then file the answer back into the right wiki tier as a new page or an addition, and append a log entry. Nothing the team learns should need to be rediscovered later.
