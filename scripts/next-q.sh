#!/usr/bin/env bash
# next-q.sh: print the next free question number for the current repo.
#
# Two-level question numbering (see CLAUDE.md "How questions are put to Tim"):
#
#   AgentTeam session (run from the team root):
#     Scans for Q<n> numbers. Prints the next integer, e.g. "Q267".
#     Only team-governance questions live here; project questions live
#     in the project repo.
#
#   Project session (run from a project repo root):
#     Detects the project prefix from .claude/project-prefix (a one-line
#     file, e.g. "CP" for Clock Practice). Scans for Q-<PREFIX><n> numbers
#     and prints the next, e.g. "Q-CP1". If .claude/project-prefix is absent
#     the script falls back to plain Q<n> numbering.
#
# Scans every questions.md file under .claude/work/ plus the canonical
# outputs/questions.md (fallback during migration window). Exits 0 on success.
#
# Usage:
#   bash scripts/next-q.sh            # prints e.g. "Q267" or "Q-CP1"
#   bash scripts/next-q.sh --help     # one-paragraph help text
#
# As of 2026-05-30 the next free AgentTeam Q-number is Q267 (highest in use: Q266).
#
# Token effect: this replaces the "Sonja reads the questions file to find
# the next free number" pattern. One Bash call, no model context spent
# on file content.

# POSIX-clean: avoid bashisms other than ${BASH_SOURCE[0]} for portability.
# The shebang requests bash; POSIX conventions are followed for the body.

case "${1:-}" in
  --help|-h)
    cat <<'HELPEOF'
next-q.sh: print the next free question number for the current repo.

AgentTeam session (run from the team root):
  Prints the next plain Q<n> number, e.g. Q267. Only team-governance
  questions use this format.

Project session (run from a project repo root):
  Reads .claude/project-prefix to find the project prefix (e.g. "CP").
  Prints the next Q-<PREFIX><n> number, e.g. Q-CP1. If the prefix file
  is absent, falls back to plain Q<n> numbering.

No options other than --help. Output is one line to stdout.
HELPEOF
    exit 0
    ;;
  "")
    # Normal run — no argument required.
    ;;
  *)
    printf 'next-q.sh: unknown argument: %s\n' "$1" >&2
    exit 2
    ;;
esac

# Locate the repository root.
# BASH_SOURCE[0] is the script itself; its parent is scripts/; one level up is the repo root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

WORK_BASE="${REPO_ROOT}/.claude/work"
CANONICAL="${REPO_ROOT}/outputs/questions.md"

# ── Detect question format (AgentTeam Q<n> vs project Q-<PREFIX><n>) ──────────

PREFIX_FILE="${REPO_ROOT}/.claude/project-prefix"
if [ -f "${PREFIX_FILE}" ]; then
  PROJECT_PREFIX="$(cat "${PREFIX_FILE}" | tr -d '[:space:]')"
else
  PROJECT_PREFIX=""
fi

# Collect source files that exist and whose folder name is valid.
sources=""
if [ -d "${WORK_BASE}" ]; then
  for f in "${WORK_BASE}"/[0-9][0-9][0-9]-*/questions.md; do
    [ -f "$f" ] || continue
    # Validate containing folder name (Jed path-traversal defence).
    folder_part="$(basename "$(dirname "$f")")"
    case "${folder_part}" in
      [0-9][0-9][0-9]-*) : ;;   # matches NNN-slug pattern
      *) continue ;;
    esac
    sources="${sources} ${f}"
  done
fi
[ -f "${CANONICAL}" ] && sources="${sources} ${CANONICAL}"

if [ -z "${sources}" ]; then
  printf 'Q1\n'
  exit 0
fi

# Extract the highest Q-number from ### Q<n>: headings (canonical format).
# Scanning only headings avoids false positives from body prose that
# mentions retracted or illustrative Q-numbers.
# grep -hoE strips filenames; the sort -n | tail -1 picks the max.
max=$(printf '%s\n' ${sources} | xargs grep -hoE '^### Q[0-9]+:' 2>/dev/null \
  | grep -oE '[0-9]+' \
  | sort -n \
  | tail -1)

# Also scan work-folder log.md files for explicit "Next free: Q<n>" or
# "Highest Q-number in use: Q<n>" lines (Tad's migration log pattern).
for logf in "${WORK_BASE}"/[0-9][0-9][0-9]-*/log.md; do
  [ -f "${logf}" ] || continue
  folder_part="$(basename "$(dirname "${logf}")")"
  case "${folder_part}" in [0-9][0-9][0-9]-*) : ;; *) continue ;; esac
  # Only match lines that explicitly document the highest Q-number in use.
  log_max=$(grep -iE 'highest Q-number in use.*Q[0-9]+|next free.*Q[0-9]+' "${logf}" 2>/dev/null \
    | grep -oE 'Q[0-9]+' \
    | grep -oE '[0-9]+' \
    | sort -n \
    | tail -1)
  # "Next free: Q104" means highest in use is Q103; adjust.
  if [ -n "${log_max}" ]; then
    # Check if the line says "next free" (meaning highest = log_max - 1)
    # or "highest in use" (meaning highest = log_max directly).
    if grep -qiE "next free.*Q${log_max}" "${logf}" 2>/dev/null; then
      log_max=$(( log_max - 1 ))
    fi
    if [ -z "${max}" ] || [ "${log_max}" -gt "${max}" ]; then
      max="${log_max}"
    fi
  fi
done

# Also scan all .md files under .claude/work/ and HANDOFF.md at the repo
# root for any Q[0-9]+ token (not just ### Q<n>: headings). This catches
# Q-numbers recorded in notes, logs, and handoff envelopes that are not in
# questions.md files. Q117 in the carol baseline audit is an example.
#
# Exclusions: github-actions-log.md and events.jsonl are gitignored
# operational logs that may contain illustrative Q-format tokens from commit
# messages or grep commands — they are not canonical Q sources.
wide_max=""
if [ -d "${WORK_BASE}" ]; then
  # Q217C fix: use \b[Qq][0-9]+[A-Za-z]?\b so answer-letter suffixes
  # (Q213A, Q216A) are consumed before the number is extracted. The previous
  # \b[Qq][0-9]+\b pattern failed because after the digits the next character
  # is the answer letter (a \w char), so no word boundary existed there and the
  # match was skipped entirely. Adding [A-Za-z]? makes the optional letter part
  # of the match; the closing \b then lands after the letter where punctuation
  # or whitespace provides the boundary. The leading \b is retained so tokens
  # embedded inside longer words (e.g. XQ9999 in prose) are still excluded.
  wide_max=$(find "${WORK_BASE}" -name '*.md' -type f \
    ! -name 'github-actions-log.md' \
    -exec grep -hoE '\b[Qq][0-9]+[A-Za-z]?\b' {} + 2>/dev/null \
    | grep -oE '[0-9]+' \
    | sort -n \
    | tail -1)
fi
handoff="${REPO_ROOT}/HANDOFF.md"
if [ -f "${handoff}" ]; then
  hmax=$(grep -oE '\b[Qq][0-9]+[A-Za-z]?\b' "${handoff}" 2>/dev/null \
    | grep -oE '[0-9]+' \
    | sort -n \
    | tail -1)
  if [ -n "${hmax}" ] && { [ -z "${wide_max}" ] || [ "${hmax}" -gt "${wide_max}" ]; }; then
    wide_max="${hmax}"
  fi
fi
# Take the highest across all passes.
if [ -n "${wide_max}" ] && { [ -z "${max}" ] || [ "${wide_max}" -gt "${max}" ]; }; then
  max="${wide_max}"
fi

if [ -n "${PROJECT_PREFIX}" ]; then
  # Project session: scan for Q-<PREFIX><n> numbers and emit the next one.
  # The pattern is Q-<PREFIX> followed by one or more digits.
  prefix_max=$(find "${WORK_BASE}" -name '*.md' -type f \
    ! -name 'github-actions-log.md' \
    -exec grep -hoiE "Q-${PROJECT_PREFIX}[0-9]+" {} + 2>/dev/null \
    | grep -oE '[0-9]+$' \
    | sort -n \
    | tail -1)
  if [ -z "${prefix_max}" ]; then
    printf 'Q-%s1\n' "${PROJECT_PREFIX}"
  else
    printf 'Q-%s%d\n' "${PROJECT_PREFIX}" "$(( prefix_max + 1 ))"
  fi
else
  # AgentTeam session: plain Q<n> numbering.
  if [ -z "${max}" ]; then
    printf 'Q1\n'
  else
    printf 'Q%d\n' "$(( max + 1 ))"
  fi
fi
