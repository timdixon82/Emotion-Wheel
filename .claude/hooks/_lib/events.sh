#!/usr/bin/env bash
# _lib/events.sh: shared helper for writing one-line JSON-Lines events.
#
# Source this file in hook scripts that need to append to events.jsonl.
# It exports one function: append_event.
#
# Usage:
#   source "$CLAUDE_PROJECT_DIR/.claude/hooks/_lib/events.sh"
#   append_event <agent> <tool> <input_summary> <output_summary> \
#                <exit_code> <token_count> <duration_ms> [<dispatch_mode>]
#
# All arguments are strings. Pass an empty string "" for unknown values.
# The function is safe: it never returns non-zero.
#
# The dispatch_mode field records whether this event was part of a
# sequential or parallel dispatch by Sonja. Valid values are:
#   "sequential"  -- the subagent was dispatched one at a time.
#   "parallel"    -- the subagent was part of a parallel dispatch group.
#   ""            -- dispatch mode was not recorded for this event.
#
# Callers that do not know the dispatch mode may omit the argument or
# pass an empty string; the field will be present in the JSON but empty.
# This lets scripts/usage.sh compute the share of parallel dispatches
# once callers are updated to supply the value.

append_event() {
  local agent="${1:-}"
  local tool="${2:-}"
  local input_summary="${3:-}"
  local output_summary="${4:-}"
  local exit_code="${5:-}"
  local token_count="${6:-}"
  local duration_ms="${7:-}"
  local dispatch_mode="${8:-}"

  # Resolve the current work folder.
  local work_dir="$CLAUDE_PROJECT_DIR/.claude/work"
  [ -f "$work_dir/.current" ] || return 0
  local current_id
  current_id=$(cat "$work_dir/.current" 2>/dev/null) || return 0
  [ -n "$current_id" ] || return 0
  # Validate current_id matches expected NNN-slug pattern (path-traversal defence).
  case "$current_id" in
    [0-9][0-9][0-9]-*) : ;;
    *) return 0 ;;
  esac
  [ -d "$work_dir/$current_id" ] || return 0

  local events_file="$work_dir/$current_id/events.jsonl"
  local ts
  ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ') || ts=""

  # Build the JSON line with jq so special characters are escaped safely.
  jq -nc \
    --arg ts "$ts" \
    --arg agent "$agent" \
    --arg tool "$tool" \
    --arg input_summary "$input_summary" \
    --arg output_summary "$output_summary" \
    --arg exit_code "$exit_code" \
    --arg token_count "$token_count" \
    --arg duration_ms "$duration_ms" \
    --arg dispatch_mode "$dispatch_mode" \
    '{
      ts: $ts,
      agent: $agent,
      tool: $tool,
      input: $input_summary,
      output: $output_summary,
      exit_code: $exit_code,
      tokens: $token_count,
      duration_ms: $duration_ms,
      dispatch_mode: $dispatch_mode
    }' >> "$events_file" 2>/dev/null || true
}
