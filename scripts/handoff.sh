#!/usr/bin/env bash
# handoff.sh: generate the mechanical part of HANDOFF.md.
#
# Decision 023: everything a session handoff reports that can be read from
# files or GitHub is gathered here, so Sonja writes only the few lines of
# judgement a script cannot: what was decided and what is next.
#
# Usage:
#   bash scripts/handoff.sh            # print the handoff to stdout
#   bash scripts/handoff.sh --write    # write HANDOFF.md, keeping any existing "## Notes" section
#
# Sections: Tim-facing tasks, active work folders, blocked folders, open
# questions, open pull requests, overdue tasks, then Notes (Sonja's lines).
# Each helper is optional; a missing one is skipped with a one-line note.

set -u

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
out="$root/HANDOFF.md"

_run() {
  # _run <script> [args...]: run a helper from scripts/ if it exists.
  local s="$root/scripts/$1"; shift
  if [ -f "$s" ]; then
    bash "$s" "$@" 2>/dev/null
  else
    echo "(not available in this repository)"
  fi
}

_or_none() {
  # Print stdin, or "None." if it is empty.
  local content
  content=$(cat)
  if [ -n "$content" ]; then printf '%s\n' "$content"; else echo "None."; fi
}

generate() {
  echo "# Handoff: $(date '+%Y-%m-%d')"
  echo ""
  echo "## Tim-facing tasks"
  echo ""
  if [ -f "$root/scripts/tasks.sh" ]; then
    if ! bash "$root/scripts/tasks.sh" --check >/dev/null 2>&1; then
      echo "Task substrate lint failed: run bash scripts/tasks.sh --check."
    fi
    bash "$root/scripts/tasks.sh" --mine 2>/dev/null | _or_none
  else
    echo "(tasks.sh not available in this repository)"
  fi
  echo ""
  echo "## Active work folders"
  echo ""
  for b in "$root"/.claude/work/*/brief.md; do
    [ -f "$b" ] || continue
    if grep -qE '^- Status: `?active`?' "$b"; then
      printf -- '- %s\n' "$(basename "$(dirname "$b")")"
    fi
  done | _or_none
  echo ""
  echo "## Blocked work folders"
  echo ""
  _run blockers.sh | grep -vE '^[[:space:]]*$' | _or_none
  echo ""
  echo "## Open questions"
  echo ""
  _run open-questions.sh | grep -E '^- |^Q' | head -20 | _or_none
  echo ""
  echo "## Open pull requests"
  echo ""
  if command -v gh >/dev/null 2>&1; then
    gh pr list --state open --limit 20 --json number,title,headRefName \
      --jq '.[] | "- #\(.number) \(.title) (branch \(.headRefName))"' 2>/dev/null | _or_none
  else
    echo "(GitHub CLI not installed)"
  fi
  echo ""
  echo "## Overdue tasks"
  echo ""
  if [ -f "$root/scripts/tasks.sh" ]; then
    bash "$root/scripts/tasks.sh" --aged 2>/dev/null | head -10 | _or_none
  else
    echo "None."
  fi
}

if [ "${1:-}" = "--write" ]; then
  notes="None."
  if [ -f "$out" ]; then
    kept=$(awk '/^## Notes$/{f=1; next} f' "$out")
    [ -n "$kept" ] && notes="$kept"
  fi
  {
    generate
    echo ""
    echo "## Notes"
    echo ""
    printf '%s\n' "$notes" | sed '/./,$!d'
  } > "$out"
  echo "Wrote $out. Replace the Notes section with at most 10 lines: what was decided and what is next."
else
  generate
fi
