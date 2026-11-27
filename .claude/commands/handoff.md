---
description: Hand off a task to a specialist agent with a structured brief
argument-hint: [agent] [task]
allowed-tools: Read, Agent
---

Hand off a task to a specialist agent with a clear, structured brief.

1. Read `$ARGUMENTS`. The first word is the agent name; the rest is the task.
2. Confirm the agent is one of the seven agents who work behind Sonja, listed in `CLAUDE.md`: the six specialists (Tad, Simon, Jacob, Jed, Sean, Carol) or Matt the reasoner.
3. Dispatch the agent with four things: the task, the context it needs, where to read in the wiki, and where to write its output.
4. When the agent returns, record the result, update the current work folder's `log.md`, and decide the next step in the routing plan.
5. If the agent has batched questions for Tim, relay them through the clarification relay: put them to Tim, then pass his answers back.
