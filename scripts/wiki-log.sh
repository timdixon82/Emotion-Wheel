#!/usr/bin/env bash
# wiki-log.sh: append one correctly formatted entry to a wiki log.
#
# Decision 023: log entries are one line under a dated heading. This script
# writes that format every time, so agents never read the log to copy its
# style and never write paragraphs into it.
#
# Usage:
#   bash scripts/wiki-log.sh <operation> "<subject>" "<one sentence>" [link] [log-file]
#     operation  one of: ingest, decision, lint, note, answer, design, query
#     link       a pull request URL, work folder path or record path (optional)
#     log-file   defaults to docs/log.md at the repository root
#
# Exit codes: 0 written, 1 bad arguments.

set -u

op="${1:-}"; subject="${2:-}"; sentence="${3:-}"; link="${4:-}"
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
log="${5:-$root/docs/log.md}"

case "$op" in
  ingest|decision|lint|note|answer|design|query) ;;
  *) echo "wiki-log.sh: operation must be one of ingest, decision, lint, note, answer, design, query." >&2; exit 1 ;;
esac
[ -n "$subject" ] && [ -n "$sentence" ] || {
  echo "wiki-log.sh: subject and sentence are required." >&2; exit 1; }
case "$subject$sentence" in
  *$'\n'*) echo "wiki-log.sh: subject and sentence must each be one line." >&2; exit 1 ;;
esac
[ -f "$log" ] || { echo "wiki-log.sh: $log not found." >&2; exit 1; }

entry="$sentence"
[ -n "$link" ] && entry="$entry See $link."

printf '\n## [%s] %s | %s\n\n%s\n' "$(date '+%Y-%m-%d')" "$op" "$subject" "$entry" >> "$log"
echo "Logged: $op | $subject"
