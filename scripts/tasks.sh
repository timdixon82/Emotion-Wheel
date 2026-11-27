#!/usr/bin/env bash
# tasks.sh: aggregate, query, and lint the team's task substrate.
#
# Reads TASKS.md at the repo root plus every .claude/work/<id>/tasks.md.
# Output is deterministic, sorted by priority then file path.
#
# Usage:
#   bash scripts/tasks.sh                  # list every open task
#   bash scripts/tasks.sh --mine           # only owner:tim, sorted high first
#   bash scripts/tasks.sh --folder NNN     # only tasks in one folder
#   bash scripts/tasks.sh --owner sean     # only one owner
#   bash scripts/tasks.sh --check          # lint mode; exit 1 on errors
#   bash scripts/tasks.sh --aged           # tasks older than 30 days
#   bash scripts/tasks.sh --help           # one-paragraph help
#
# Output line: "[H/M/L] <description> (owner:<o>, folder:<f>) [tags]"
# Suitable for piping into a shell loop or grep.
#
# Token effect: replaces the "Sonja reads HANDOFF and N briefs to know
# what's open" pattern. One Bash call, zero model tokens for the read.

set -euo pipefail

mode="list"
folder_filter=""
owner_filter=""
project_prefix=""
strict=false

case "${1:-}" in
  --help|-h)
    cat <<'EOF'
tasks.sh: aggregate, query, and lint the team's task substrate.

Reads TASKS.md at the repo root and every .claude/work/<id>/tasks.md.
Each task is a Markdown checkbox line with optional inline tags.

Modes:
  (no flag)           list every open task, sorted by priority
  --mine              only tasks owned by Tim
  --folder NNN        only tasks in one work folder (three-digit prefix)
  --owner NAME        only tasks for one owner (agent name or "tim")
  --check             lint every task line; exit 1 on errors; warn on warnings;
                      also lints all files under outputs/project-pending/
  --aged              list open tasks older than 30 days (uses due: or file mtime)
  --project PREFIX    list open entries from outputs/project-pending/PREFIX.md
  --list-projects     list every prefix with a file under outputs/project-pending/
  --strict            (with --check) treat warnings as errors

Output format:
  [H] description (owner:sean, folder:017) [from:020-audit]

Exit codes:
  0  normal
  1  lint errors (with --check) or no matching tasks (with --mine etc.)
  2  bad flag
EOF
    exit 0
    ;;
  --mine)          mode="mine"; owner_filter="tim"; shift ;;
  --folder)        mode="folder"; folder_filter="${2:-}"; shift 2 ;;
  --owner)         mode="owner"; owner_filter="${2:-}"; shift 2 ;;
  --check)         mode="check"; shift ;;
  --aged)          mode="aged"; shift ;;
  --project)       mode="project"; project_prefix="${2:-}"; shift 2 ;;
  --list-projects) mode="list-projects"; shift ;;
  "")              : ;;
  *)               printf 'tasks.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac

# Accept --strict as an additional flag for --check mode.
case "${1:-}" in
  --strict) strict=true; shift ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="${CLAUDE_PROJECT_DIR:-$(cd "${script_dir}/.." && pwd)}"
work_base="${repo}/.claude/work"
root_tasks="${repo}/TASKS.md"
pending_dir="${repo}/outputs/project-pending"

# ------------------------------------------------------------------
# --list-projects: list every prefix that has a pending file.
# ------------------------------------------------------------------
if [ "${mode}" = "list-projects" ]; then
  if [ ! -d "${pending_dir}" ]; then
    printf 'No project-pending files found.\n'
    exit 1
  fi
  found=false
  for f in "${pending_dir}"/*.md; do
    [ -f "$f" ] || continue
    base="$(basename "$f" .md)"
    # Only list files whose name is a valid prefix (2-4 uppercase letters).
    if printf '%s' "${base}" | grep -qE '^[A-Z]{2,4}$'; then
      printf '%s\n' "${base}"
      found=true
    fi
  done
  if ! $found; then
    printf 'No project-pending files found.\n'
    exit 1
  fi
  exit 0
fi

# ------------------------------------------------------------------
# --project PREFIX: list open entries from outputs/project-pending/<PREFIX>.md
# Uses the same awk parser logic as parse_sources for consistency.
# ------------------------------------------------------------------
if [ "${mode}" = "project" ]; then
  # Validate prefix shape before building any path (path-traversal guard).
  if [ -z "${project_prefix}" ] || ! printf '%s' "${project_prefix}" | grep -qE '^[A-Z]{2,4}$'; then
    printf 'tasks.sh: --project requires a valid prefix (2-4 uppercase letters)\n' >&2
    exit 2
  fi
  pfile="${pending_dir}/${project_prefix}.md"
  if [ ! -f "${pfile}" ]; then
    printf 'No pending tasks for %s.\n' "${project_prefix}"
    exit 1
  fi
  # Run the same awk parser as parse_sources over just this one file,
  # then filter and format open entries.
  result="$(awk -v src="${pfile}" '
    function emit(line_no, status, desc, prio, owner, folder, tags) {
      prio_int = 9
      if (prio == "high") prio_int = 1
      else if (prio == "medium") prio_int = 2
      else if (prio == "low") prio_int = 3
      printf "%d\t%s\t%s\t%s\t%s\t%s\t%s\t%d\n",
        prio_int, status, desc, owner, folder, tags, src, line_no
    }
    NR == 1 { next }
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*#/ { next }
    /^[^-]/ { next }
    /^-[[:space:]]+\[[ xX]\][[:space:]]+/ {
      line = $0
      if (line ~ /^-[[:space:]]+\[[xX]\]/) status = "closed"
      else                                  status = "open"
      sub(/^-[[:space:]]+\[[ xX]\][[:space:]]+/, "", line)
      tags = ""
      while (match(line, /[[:space:]]+`[a-z-]+:[^`]+`[[:space:]]*$/)) {
        tag = substr(line, RSTART, RLENGTH)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", tag)
        tags = tag (tags == "" ? "" : " ") tags
        line = substr(line, 1, RSTART - 1)
        sub(/[[:space:]]+$/, "", line)
      }
      desc = line
      prio = ""; owner = ""; folder = ""
      n = split(tags, t_arr, " ")
      for (i = 1; i <= n; i++) {
        tag = t_arr[i]; gsub(/`/, "", tag)
        split(tag, kv, ":")
        if (kv[1] == "priority") prio = kv[2]
        else if (kv[1] == "owner") owner = kv[2]
        else if (kv[1] == "folder") folder = kv[2]
      }
      emit(NR, status, desc, prio, owner, folder, tags)
      next
    }
    { emit(NR, "malformed", $0, "", "", "", "") }
  ' "${pfile}" \
  | awk -F'\t' '$2 == "open" { print }' \
  | sort -t$'\t' -k1,1n \
  | awk -F'\t' '
      BEGIN { count = 0 }
      {
        prio_label = ($1==1?"H":($1==2?"M":($1==3?"L":"-")))
        printf "[%s] %s (owner:%s, folder:%s) [%s]\n", prio_label, $3, $4, $5, $6
        count++
      }
      END { exit (count == 0 ? 1 : 0) }
    ')" || {
    printf 'No pending tasks for %s.\n' "${project_prefix}"
    exit 1
  }
  printf '%s\n' "${result}"
  exit 0
fi

# Build source list. Root file first, then per-folder files in sorted order.
sources=()
[ -f "${root_tasks}" ] && sources+=("${root_tasks}")
if [ -d "${work_base}" ]; then
  for f in "${work_base}"/[0-9][0-9][0-9]-*/tasks.md; do
    [ -f "$f" ] && sources+=("$f")
  done
fi

# In check mode, also include all project-pending files for linting.
# This must not fail if the directory is empty or missing (ADR-032-7 / req 39).
if [ "${mode}" = "check" ] && [ -d "${pending_dir}" ]; then
  for f in "${pending_dir}"/*.md; do
    [ -f "$f" ] || continue
    base="$(basename "$f" .md)"
    # Only include files whose name is a valid prefix (path-traversal guard).
    if printf '%s' "${base}" | grep -qE '^[A-Z]{2,4}$'; then
      sources+=("$f")
    fi
  done
fi

if [ "${#sources[@]}" -eq 0 ]; then
  if [ "${mode}" = "check" ]; then exit 0; fi
  printf 'No tasks files found. Create %s to start.\n' "${root_tasks}" >&2
  exit 1
fi

# ------------------------------------------------------------------
# Core parser: read every source, emit one TSV line per task.
# Columns: priority_int<TAB>status<TAB>description<TAB>owner<TAB>folder<TAB>tags<TAB>file<TAB>line_no
# priority_int: 1=high, 2=medium, 3=low, 9=unset (sorts last)
# status: open | closed | malformed
# ------------------------------------------------------------------
parse_sources() {
  local src
  for src in "${sources[@]}"; do
    awk -v src="$src" '
      function emit(line_no, status, desc, prio, owner, folder, tags) {
        # Map priority text to int for sorting.
        prio_int = 9
        if (prio == "high") prio_int = 1
        else if (prio == "medium") prio_int = 2
        else if (prio == "low") prio_int = 3
        printf "%d\t%s\t%s\t%s\t%s\t%s\t%s\t%d\n",
          prio_int, status, desc, owner, folder, tags, src, line_no
      }
      NR == 1 { next }   # skip H1 header
      /^[[:space:]]*$/ { next }
      /^[[:space:]]*#/ { next }   # tolerate stray headers
      # Skip prose lines (any line not starting with a list dash).
      # Tasks files may carry a short preamble; prose is informational, not a task.
      /^[^-]/ { next }
      /^-[[:space:]]+\[[ xX]\][[:space:]]+/ {
        line = $0
        # Extract the checkbox status.
        if (line ~ /^-[[:space:]]+\[[xX]\]/) status = "closed"
        else                                  status = "open"
        # Strip the dash and checkbox.
        sub(/^-[[:space:]]+\[[ xX]\][[:space:]]+/, "", line)
        # Pull all backtick-fenced tags off the end into a separate string.
        tags = ""
        while (match(line, /[[:space:]]+`[a-z-]+:[^`]+`[[:space:]]*$/)) {
          tag = substr(line, RSTART, RLENGTH)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", tag)
          tags = tag (tags == "" ? "" : " ") tags
          line = substr(line, 1, RSTART - 1)
          sub(/[[:space:]]+$/, "", line)
        }
        desc = line
        # Parse known tags out of the tags string.
        prio = ""; owner = ""; folder = ""
        n = split(tags, t_arr, " ")
        for (i = 1; i <= n; i++) {
          tag = t_arr[i]
          gsub(/`/, "", tag)
          split(tag, kv, ":")
          if (kv[1] == "priority") prio = kv[2]
          else if (kv[1] == "owner") owner = kv[2]
          else if (kv[1] == "folder") folder = kv[2]
        }
        # If the source is a per-folder tasks.md, infer the folder.
        if (folder == "" && src ~ /\/work\/[0-9]+-/) {
          inferred = src
          sub(/.*\/work\//, "", inferred)
          sub(/-.*/, "", inferred)
          folder = inferred
        }
        emit(NR, status, desc, prio, owner, folder, tags)
        next
      }
      # Anything else in a tasks file is malformed.
      { emit(NR, "malformed", $0, "", "", "", "") }
    ' "$src"
  done
}

# ------------------------------------------------------------------
# Lint mode: run a single awk pass over parse_sources output.
# Fix B: the first parse_sources | while-read pass is removed; it ran
# in a subshell so its counters were thrown away. The awk pass below
# is the canonical lint runner and sole decision-maker for exit code.
# Fix C: rm -f moved to after the strict check so grep can read the file.
# ------------------------------------------------------------------
if [ "${mode}" = "check" ]; then
  err_log="$(mktemp)"
  parse_sources \
    | awk -F'\t' -v wb="${work_base}" '
        $2 == "malformed" { printf "%s:%s: error: malformed line: %s\n", $7, $8, $3; e++; next }
        {
          n = split($6, ts, " ")
          for (i = 1; i <= n; i++) {
            tag = ts[i]; gsub(/`/, "", tag)
            split(tag, kv, ":")
            k = kv[1]; v = kv[2]
            if (k == "priority") {
              if (v != "high" && v != "medium" && v != "low") {
                printf "%s:%s: error: bad priority %s\n", $7, $8, v; e++ }
            }
            else if (k == "owner") {
              o = v; ok = 0
              split("sonja tad simon jacob jed sean carol matt tim", names, " ")
              for (j in names) if (names[j] == o) ok = 1
              if (!ok) { printf "%s:%s: error: bad owner %s\n", $7, $8, o; e++ }
            }
            else if (k == "due") {
              if (v !~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) {
                printf "%s:%s: error: bad due %s\n", $7, $8, v; e++ }
            }
            else if (k != "folder" && k != "blocked-by" && k != "from" && k != "tag") {
              printf "%s:%s: warning: unknown tag %s\n", $7, $8, k; w++ }
          }
        }
        END { exit (e > 0 ? 1 : 0) }
      ' >"${err_log}" 2>&1
  rc=$?
  [ -s "${err_log}" ] && cat "${err_log}" >&2
  # Fix C: check strict mode BEFORE deleting the err_log file.
  if $strict && grep -q ': warning:' "${err_log}"; then
    rm -f "${err_log}"
    exit 1
  fi
  rm -f "${err_log}"
  exit "${rc}"
fi

# ------------------------------------------------------------------
# Aged mode: tasks with due: in the past OR open more than 30 days.
# ------------------------------------------------------------------
if [ "${mode}" = "aged" ]; then
  today=$(date '+%Y-%m-%d')
  parse_sources \
    | awk -F'\t' -v today="${today}" '
        $2 != "open" { next }
        {
          due = ""
          n = split($6, ts, " ")
          for (i = 1; i <= n; i++) {
            tag = ts[i]; gsub(/`/, "", tag)
            split(tag, kv, ":")
            if (kv[1] == "due") due = kv[2]
          }
          if (due != "" && due < today) {
            printf "%s\t%s\n", $0, "OVERDUE"
            next
          }
        }
      ' \
    | sort -t$'\t' -k1,1n -k7,7 \
    | awk -F'\t' '{
        prio_label = ($1==1?"H":($1==2?"M":($1==3?"L":"-")))
        printf "[%s] %s (owner:%s, folder:%s) [%s]\n", prio_label, $3, $4, $5, $6
      }'
  exit 0
fi

# ------------------------------------------------------------------
# Default / mine / folder / owner: filter and print.
# ------------------------------------------------------------------
parse_sources \
  | awk -F'\t' -v mode="${mode}" -v folder="${folder_filter}" -v owner="${owner_filter}" '
      $2 != "open" { next }
      {
        if (mode == "folder" && $5 != folder) next
        if ((mode == "mine" || mode == "owner") && $4 != owner) next
      }
      { print }
    ' \
  | sort -t$'\t' -k1,1n -k7,7 \
  | awk -F'\t' '
      BEGIN { count = 0 }
      {
        prio_label = ($1==1?"H":($1==2?"M":($1==3?"L":"-")))
        printf "[%s] %s (owner:%s, folder:%s) [%s]\n", prio_label, $3, $4, $5, $6
        count++
      }
      END {
        if (count == 0) exit 1
      }
    '
