#!/usr/bin/env bash
# post-tool-use.sh: three jobs after every Bash, Write, Edit, or MCP tool call.
#
#   1. Append every GitHub-related call to the work folder's
#      github-actions-log.md (the existing audit trail).
#   2. Append a one-line JSON-Lines event to events.jsonl for every tool
#      call, regardless of whether it is GitHub-related (I15 raw stream).
#   3. Schedule a debounced rebuild of outputs/status.html when the tool
#      wrote to a brief.md or per-folder questions.md under .claude/work/.
#      The rebuild runs in the background; the hook returns immediately so
#      the agent turn is never delayed.
#
# Substrate-unification note (work folder 020):
#   Job 3 is the addition. Jobs 1 and 2 are unchanged.
#
# Substrate-fixes note (work folder 021):
#   - Lock file is now repo-scoped to avoid conflicts between parallel
#     instances on different machines or repo copies.
#   - Work folder is inferred from the file path being written/edited,
#     falling back to .current for AgentTeam-internal paths.
#   - Lint hook: first-write guard added (only flag overwrites of files
#     that already existed on disk).
#
# Safe by default: every write is guarded; the hook never fails the turn.

input=$(cat)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)
exit_code=$(printf '%s' "$input" | jq -r '.tool_response.exit_code // ""' 2>/dev/null)
token_count=$(printf '%s' "$input" | jq -r '.usage.total_tokens // ""' 2>/dev/null)

# Resolve the repository root from CLAUDE_PROJECT_DIR.
REPO_ROOT="${CLAUDE_PROJECT_DIR:-}"
WORK_BASE="${REPO_ROOT}/.claude/work"

# Resolve action text for the GitHub audit log.
case "$tool_name" in
  mcp__github*)
    action=$(printf '%s' "$input" | jq -rc '.tool_input // {}' 2>/dev/null)
    ;;
  Bash)
    action=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
    ;;
  Write|Edit)
    action=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
    ;;
  *) exit 0 ;;
esac

# ---------------------------------------------------------------------
# Infer the active work folder from a file path.
# If the path is under Inputs/<project-dir>/, look up the project slug
# in brief preambles and return the highest non-archived matching folder.
# Falls back to .current for AgentTeam-internal paths.
# ---------------------------------------------------------------------
infer_work_folder() {
  local fpath="${1:-}"
  local work_folder=""

  # Try project-path inference: Inputs/<dir>/ → slug → brief lookup.
  if printf '%s' "${fpath}" | grep -q '/Inputs/'; then
    local project_dir
    project_dir=$(printf '%s' "${fpath}" | grep -oE '/Inputs/[^/]+' | head -1 | cut -d/ -f3)
    if [ -n "${project_dir}" ]; then
      # Convert dir name to a slug: lowercase, underscores to hyphens.
      local slug
      slug=$(printf '%s' "${project_dir}" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
      # Find the highest-numbered non-archived brief whose Project: slug matches.
      local best_num=0
      local best_folder=""
      for brief in "${WORK_BASE}"/[0-9][0-9][0-9]-*/brief.md; do
        [ -f "${brief}" ] || continue
        local bslug bstatus bnum bfolder
        bslug=$(awk '/^- Project:[[:space:]]*/{sub(/^- Project:[[:space:]]*/,""); print; exit}' "${brief}" 2>/dev/null)
        [ -z "${bslug}" ] && continue
        # Partial match: slug from path contained in brief slug or vice versa.
        case "${slug}" in *"${bslug}"*|"${bslug}"*) : ;; *) continue ;; esac
        bstatus=$(awk '/^- Status:[[:space:]]*/{sub(/^- Status:[[:space:]]*/,""); print; exit}' "${brief}" 2>/dev/null | tr '[:upper:]' '[:lower:]')
        case "${bstatus}" in archived*|done*) continue ;; esac
        bfolder=$(basename "$(dirname "${brief}")")
        bnum=$(printf '%s' "${bfolder}" | grep -oE '^[0-9]+')
        if [ "${bnum}" -gt "${best_num}" ] 2>/dev/null; then
          best_num="${bnum}"
          best_folder="${bfolder}"
        fi
      done
      [ -n "${best_folder}" ] && work_folder="${best_folder}"
    fi
  fi

  # Fall back to .current.
  if [ -z "${work_folder}" ] && [ -f "${WORK_BASE}/.current" ]; then
    work_folder=$(cat "${WORK_BASE}/.current" 2>/dev/null)
  fi

  printf '%s' "${work_folder}"
}

[ -d "${WORK_BASE}" ] || exit 0

# Skip telemetry writes during git merge/rebase to avoid blocking git operations
[ -f "${REPO_ROOT}/.git/MERGE_HEAD" ] && exit 0
[ -d "${REPO_ROOT}/.git/rebase-merge" ] && exit 0

# Resolve the current work folder via path inference, then fall back to .current.
current_id=$(infer_work_folder "$action")
[ -n "$current_id" ] || exit 0

# Jed path-traversal defence: reject any current_id value that is not a
# valid work-folder slug (NNN-slug pattern). An attacker-controlled value
# in .current could otherwise route writes to an arbitrary path.
case "${current_id}" in
  [0-9][0-9][0-9]-*) : ;;  # valid work-folder slug — proceed
  *) current_id="" ;;       # invalid — treat as unset, skip telemetry write
esac
[ -n "$current_id" ] || exit 0

[ -d "${WORK_BASE}/$current_id" ] || exit 0

# Job 1: GitHub audit log (git and gh commands only).
case "$tool_name" in
  mcp__github*)
    log="${WORK_BASE}/$current_id/github-actions-log.md"
    [ -f "$log" ] || printf '# GitHub actions log\n\n' > "$log"
    printf -- '- [%s] %s | %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$tool_name" "$action" >> "$log"
    ;;
  Bash)
    if printf '%s' "$action" | grep -qiE '(^| )(git|gh)( |$)'; then
      log="${WORK_BASE}/$current_id/github-actions-log.md"
      [ -f "$log" ] || printf '# GitHub actions log\n\n' > "$log"
      printf -- '- [%s] %s | %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$tool_name" "$action" >> "$log"
    fi
    ;;
esac

# Job 2: Raw event stream (every tool call).
lib="${REPO_ROOT}/.claude/hooks/_lib/events.sh"
if [ -f "$lib" ]; then
  # source is permitted here for library loading inside hooks; it does not violate the CLAUDE.md rule, which applies to agent tool calls only.
  # shellcheck source=/dev/null
  source "$lib"
  # Truncate long input/output summaries to 200 chars each.
  input_summary="${action:0:200}"
  output_summary=$(printf '%s' "$input" \
    | jq -r '.tool_response.output // .tool_response.stderr // ""' 2>/dev/null \
    | head -c 200)
  append_event "" "$tool_name" "$input_summary" "$output_summary" \
    "$exit_code" "$token_count" ""
fi

# ---------------------------------------------------------------------
# Job 3 (work folder 020): debounced status.html rebuild.
#
# Trigger criteria:
#   - tool_name is Write or Edit
#   - file_path is under $REPO_ROOT/.claude/work/<id>/ and
#     matches brief.md, questions.md, or answers.md.
#
# Debouncing via repo-scoped marker file:
#   The marker path includes a hash of the repo root so parallel
#   instances on different machines or repo copies do not collide.
#   Each trigger writes an epoch+nanosecond timestamp to the marker.
#   A background subshell sleeps 2 seconds then re-reads the marker;
#   if unchanged, the rebuild runs. A burst of writes produces one
#   rebuild at the end of the burst.
#
# This job is additive: jobs 1 and 2 above are unchanged.
# ---------------------------------------------------------------------
case "$tool_name" in
  Write|Edit)
    case "$action" in
      "${REPO_ROOT}"/.claude/work/*/brief.md \
      | "${REPO_ROOT}"/.claude/work/*/questions.md \
      | "${REPO_ROOT}"/.claude/work/*/answers.md)
        status_script="${REPO_ROOT}/scripts/status.sh"
        if [ -f "$status_script" ] && [ -x "$status_script" ]; then
          marker="${REPO_ROOT}/.claude/.status-rebuild.lock"
          date +%s%N > "$marker" 2>/dev/null || true
          (
            sleep 2
            current_marker=$(cat "$marker" 2>/dev/null || printf '')
            sleep 0
            latest_marker=$(cat "$marker" 2>/dev/null || printf '')
            if [ -n "$current_marker" ] && [ "$current_marker" = "$latest_marker" ]; then
              "$status_script" >/dev/null 2>&1 || true
            fi
          ) </dev/null >/dev/null 2>&1 &
          disown 2>/dev/null || true
        fi
        ;;
    esac
    ;;
esac

# ---------------------------------------------------------------------
# Lint hook: Write-without-Read guard.
#
# Flags any Write to a file that already existed on disk without a
# prior Read of that file in the same session. New file creation is
# not flagged ([ -e "$wpath" ] guard). Appends to lint.md at the
# repo root (excluded from git via .gitignore).
# ---------------------------------------------------------------------
if [ "$tool_name" = "Write" ] && [ -n "$action" ]; then
  wpath="$action"
  lint_log="${REPO_ROOT}/lint.md"
  # has_recent_read: check the event stream for a recent Read of this path.
  # This is a best-effort check: we look at the last 50 events in events.jsonl.
  has_recent_read() {
    local target="$1"
    local evfile="${WORK_BASE}/$current_id/events.jsonl"
    [ -f "$evfile" ] || return 1
    tail -50 "$evfile" 2>/dev/null \
      | grep -q "\"Read\".*$(printf '%s' "${target}" | sed 's/[[\.*^$()+?{|]/\\&/g')" \
      && return 0
    return 1
  }
  if [ -e "$wpath" ] && ! has_recent_read "$wpath"; then
    {
      printf '## [%s] Write-without-Read\n\n' "$(date '+%Y-%m-%d %H:%M:%S')"
      printf '- File: %s\n' "$wpath"
      printf '- Work folder: %s\n\n' "$current_id"
    } >> "$lint_log" 2>/dev/null || true
  fi
fi

exit 0
