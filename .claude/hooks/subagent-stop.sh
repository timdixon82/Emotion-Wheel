#!/usr/bin/env bash
# subagent-stop.sh: four jobs when a subagent finishes.
#
#   1. Record the subagent completion in the work folder's log.md
#      (the existing curated decision log).
#   2. Append a one-line JSON-Lines event to events.jsonl (I15 raw stream).
#   3. Scan the subagent's tool log for Write calls to files that were not
#      Read in the same dispatch. Unmatched Writes append a one-line lint
#      warning to events.jsonl and to lint.md at the repo root. Informational
#      only; the hook never fails the turn.
#   4. Capture <!-- TASK --> markers from subagents and route to tasks.md.
#
# Work-folder routing (replaces .current):
#   .claude/work/.path-index maps folder names to the repository path they
#   are doing work in. Format: <folder-name> <repo-path> (space-separated).
#   Append-only; last entry per folder-name wins (supersede semantics).
#   Folders that no longer exist on disk are skipped automatically.
#
#   Matching: the hook collects all file paths the subagent touched (Read,
#   Write, Edit tool calls) and checks whether any touched path lives under
#   a registered repo-path. All matching folders receive a log entry
#   (cross-repo dispatch support). When multiple folders are registered for
#   the same repo-path, the folder whose log.md was most recently modified
#   wins (mtime tiebreaker). Fallback: if no path-index entry matches, the
#   hook routes to the most recently modified log.md across all work folders.
#
#   Sonja maintains the path-index: append a line whenever a work folder is
#   created or activated. See docs/decisions/015-path-index-routing.md.

input=$(cat)
reason=$(printf '%s' "$input" | jq -r '.reason // ""' 2>/dev/null)
token_count=$(printf '%s' "$input" | jq -r '.usage.total_tokens // ""' 2>/dev/null)
# Claude Code sends the subagent's own transcript path rather than a token
# count. Count the subagent's tokens from it (Decision 023).
if [ -z "$token_count" ]; then
  agent_transcript=$(printf '%s' "$input" | jq -r '.agent_transcript_path // ""' 2>/dev/null)
  if [ -n "$agent_transcript" ] && [ -f "$agent_transcript" ] \
      && [ -f "$CLAUDE_PROJECT_DIR/scripts/token-report.sh" ]; then
    token_count=$(bash "$CLAUDE_PROJECT_DIR/scripts/token-report.sh" --total "$agent_transcript" 2>/dev/null) || token_count=""
  fi
fi
agent=$(printf '%s' "$input" | jq -r '.agent_name // .subagent_name // ""' 2>/dev/null)

work_dir="$CLAUDE_PROJECT_DIR/.claude/work"
path_index="$work_dir/.path-index"

# Job 3 needs tool_uses; extract it once here for reuse.
tool_uses=$(printf '%s' "$input" | jq -c '.tool_uses // []' 2>/dev/null)

# -------------------------------------------------------------------------
# Extract file paths the subagent touched (Read, Write, Edit).
# Used by path-index routing to identify which work folder(s) to credit.
# -------------------------------------------------------------------------
touched_paths=""
if [ -n "$tool_uses" ] && [ "$tool_uses" != "[]" ] && [ "$tool_uses" != "null" ]; then
  touched_paths=$(printf '%s' "$tool_uses" \
    | jq -r '.[] | select(.tool_name == "Read" or .tool_name == "Write" or .tool_name == "Edit") | .tool_input.file_path // empty' \
    2>/dev/null | sort -u)
fi

# -------------------------------------------------------------------------
# Path-index routing: find all work folders that match this dispatch.
#
# matched_with_mtime: lines of "<mtime> <folder-name> <repo-path>"
# One line per matching folder, for mtime tiebreaker processing.
# -------------------------------------------------------------------------
matched_with_mtime=""

if [ -f "$path_index" ]; then
  # Deduplicate: last entry per folder-name wins.
  # Ignore comment lines (starting with #) and blank lines.
  deduped=$(awk '
    /^[[:space:]]*#/ { next }
    NF == 2 { last[$1] = $2 }
    END { for (f in last) print f, last[f] }
  ' "$path_index")

  while IFS=' ' read -r fname rpath; do
    [ -z "$fname" ] || [ -z "$rpath" ] && continue
    # Validate fname matches the expected NNN-slug pattern (path-traversal defence).
    case "$fname" in
      [0-9][0-9][0-9]-*) : ;;
      *) continue ;;
    esac
    [ -d "$work_dir/$fname" ] || continue          # skip archived / missing

    norm_rpath=$(realpath "$rpath" 2>/dev/null || printf '%s' "$rpath")
    norm_rpath="${norm_rpath%/}"

    found=false
    while IFS= read -r tpath; do
      [ -z "$tpath" ] && continue
      norm_tpath=$(realpath "$tpath" 2>/dev/null || printf '%s' "$tpath")
      norm_tpath="${norm_tpath%/}"
      case "$norm_tpath" in
        "$norm_rpath"|"$norm_rpath/"*)
          found=true
          break
          ;;
      esac
    done <<< "$touched_paths"

    if $found; then
      logf="$work_dir/$fname/log.md"
      mt=$(stat -f '%m' "$logf" 2>/dev/null \
        || stat -c '%Y' "$logf" 2>/dev/null \
        || echo 0)
      matched_with_mtime="${matched_with_mtime}${mt} ${fname} ${norm_rpath}
"
    fi
  done <<< "$deduped"
fi

# Mtime tiebreaker: for each unique repo-path, keep only the most recently
# modified folder. Collect surviving folder names, one per line.
final_folders=""
if [ -n "$matched_with_mtime" ]; then
  final_folders=$(printf '%s' "$matched_with_mtime" \
    | sort -k3 -k1,1rn \
    | awk 'NF >= 2 && !seen[$3]++ { print $2 }')
fi

# Fallback: if no path-index entry matched, route to the most recently
# modified log.md across all existing work folders.
if [ -z "$final_folders" ]; then
  best=""
  best_mt=0
  for d in "$work_dir"/*/; do
    [ -d "$d" ] || continue
    logf="${d}log.md"
    [ -f "$logf" ] || continue
    mt=$(stat -f '%m' "$logf" 2>/dev/null \
      || stat -c '%Y' "$logf" 2>/dev/null \
      || echo 0)
    if [ "$mt" -gt "$best_mt" ] 2>/dev/null; then
      best_mt="$mt"
      best=$(basename "$d")
    fi
  done
  [ -n "$best" ] && final_folders="$best"
fi

[ -n "$final_folders" ] || exit 0

# Primary folder: first match. Used for jobs that write to a single location.
primary_id=$(printf '%s\n' "$final_folders" | head -1)
primary_log="$work_dir/$primary_id/log.md"

# -------------------------------------------------------------------------
# Job 1: Write "subagent completed" to ALL matched work folder logs.
# -------------------------------------------------------------------------
while IFS= read -r current_id; do
  [ -z "$current_id" ] && continue
  log="$work_dir/$current_id/log.md"
  [ -f "$log" ] || printf '# Work log\n\n' > "$log"
  if [ -n "$reason" ]; then
    printf -- '- [%s] subagent completed: %s\n' \
      "$(date '+%Y-%m-%d %H:%M:%S')" "$reason" >> "$log"
  else
    printf -- '- [%s] subagent completed\n' \
      "$(date '+%Y-%m-%d %H:%M:%S')" >> "$log"
  fi
done <<< "$final_folders"

# -------------------------------------------------------------------------
# Job 2: Raw event stream.
# -------------------------------------------------------------------------
lib="$CLAUDE_PROJECT_DIR/.claude/hooks/_lib/events.sh"
if [ -f "$lib" ]; then
  # shellcheck source=/dev/null
  source "$lib"
  reason_summary="${reason:0:200}"
  append_event "$agent" "SubagentStop" "agent-return" "$reason_summary" \
    "" "$token_count" ""
fi

# -------------------------------------------------------------------------
# Job 3: Write-without-read lint.
# -------------------------------------------------------------------------
if [ -n "$tool_uses" ] && [ "$tool_uses" != "[]" ] && [ "$tool_uses" != "null" ]; then
  read_paths=$(printf '%s' "$tool_uses" \
    | jq -r '.[] | select(.tool_name == "Read") | .tool_input.file_path // empty' \
    2>/dev/null | sort -u)
  write_paths=$(printf '%s' "$tool_uses" \
    | jq -r '.[] | select(.tool_name == "Write") | .tool_input.file_path // empty' \
    2>/dev/null)

  lint_file="$CLAUDE_PROJECT_DIR/lint.md"
  unmatched_count=0

  while IFS= read -r wpath; do
    [ -z "$wpath" ] && continue
    matched=false
    wdir=$(dirname "$wpath")
    wbase=$(basename "$wpath")
    while IFS= read -r rpath; do
      [ -z "$rpath" ] && continue
      rdir=$(dirname "$rpath")
      rbase=$(basename "$rpath")
      if [ "$wdir" = "$rdir" ] && [ "$wbase" = "$rbase" ]; then
        matched=true
        break
      fi
    done <<< "$read_paths"

    if ! $matched; then
      unmatched_count=$(( unmatched_count + 1 ))
      if [ ! -f "$lint_file" ]; then
        printf '# Write-without-read lint log\n\nAppend-only. Each line: ISO timestamp, agent, target path. A line\nappears here when a subagent dispatch ended with at least one Write call\nto a file that was not Read in the same dispatch. Reading before writing\nis the cheaper pattern: it lets Edit work, and Edit sends only the diff\ninstead of the whole file.\n\n' > "$lint_file"
      fi
      printf -- '- [%s] %s | Write without Read: %s\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" "${agent:-unknown}" "$wpath" >> "$lint_file"
      if [ -f "$lib" ]; then
        append_event "$agent" "Lint" "write-without-read" "$wpath" "" "" ""
      fi
      wf_events="$work_dir/$primary_id/events.jsonl"
      ts="$(date '+%Y-%m-%dT%H:%M:%S')"
      printf '{"ts":"%s","type":"Lint","subtype":"write-without-read","agent":"%s","path":"%s"}\n' \
        "${ts}" "${agent:-unknown}" "${wpath}" >> "${wf_events}" 2>/dev/null || true
    fi
  done <<< "$write_paths"

  if [ "$unmatched_count" -gt 0 ]; then
    if [ "$unmatched_count" -eq 1 ]; then
      printf -- '- [%s] lint: %s wrote 1 file without Reading first; see lint.md\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" "${agent:-unknown}" >> "$primary_log"
    else
      printf -- '- [%s] lint: %s wrote %d files without Reading first; see lint.md\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" "${agent:-unknown}" "$unmatched_count" >> "$primary_log"
    fi
  fi
fi

# -------------------------------------------------------------------------
# Job 4: Capture <!-- TASK --> markers from subagents.
#
# Two variants are handled independently:
#   <!-- TASK project: <PREFIX> --> routes to outputs/project-pending/<PREFIX>.md
#   <!-- TASK -->                   routes to a work folder or root TASKS.md
# The project: variant is processed first. Existing routing is unchanged.
# -------------------------------------------------------------------------
agent_text=$(printf '%s' "$input" \
  | jq -r '.text // .response // .reason // ""' 2>/dev/null)

# ---- 4a: route <!-- TASK project: PREFIX --> blocks ----------------------
if [ -n "${agent_text}" ] && printf '%s' "${agent_text}" | grep -qE '<!-- TASK project: [A-Z][A-Z0-9]{1,5} -->'; then
  pending_helper="${CLAUDE_PROJECT_DIR}/scripts/project-pending.sh"
  lint_file="${CLAUDE_PROJECT_DIR}/lint.md"

  # Extract each project-tagged block. Use awk to isolate blocks between
  # <!-- TASK project: PREFIX --> and <!-- /TASK -->.
  # Uses BSD awk-compatible syntax (no gawk array capture in match()).
  printf '%s' "${agent_text}" | awk '
    BEGIN { in_block = 0; prefix = "" }
    /<!-- TASK project: [A-Z][A-Z0-9]{1,5} -->/ {
      in_block = 1
      # Extract prefix using sub (BSD awk compatible).
      tmp = $0
      sub(/^.*<!-- TASK project: /, "", tmp)
      sub(/ -->.*$/, "", tmp)
      prefix = tmp
      next
    }
    /<!-- \/TASK -->/ {
      in_block = 0
      prefix = ""
      next
    }
    in_block && /^[[:space:]]*-[[:space:]]+\[[ xX]\][[:space:]]+/ {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      if (length(line) > 600) line = substr(line, 1, 597) "..."
      # Print "PREFIX<TAB>task-line" so the shell loop can split them.
      printf "%s\t%s\n", prefix, line
    }
  ' | while IFS=$'\t' read -r block_prefix task_line; do
    [ -z "${block_prefix}" ] || [ -z "${task_line}" ] && continue

    if [ -f "${pending_helper}" ] && [ -x "${pending_helper}" ]; then
      if ! bash "${pending_helper}" "${block_prefix}" "${task_line}" 2>/dev/null; then
        # Helper failed (invalid prefix or other error). Write warning to lint.md.
        if [ ! -f "${lint_file}" ]; then
          printf '# Write-without-read lint log\n\nAppend-only.\n\n' > "${lint_file}"
        fi
        printf -- '- [%s] project-pending: routing failed for prefix %s — see project-pending.sh output\n' \
          "$(date '+%Y-%m-%d %H:%M:%S')" "${block_prefix}" >> "${lint_file}"
      fi
    else
      # Helper not found. Write warning to lint.md.
      if [ ! -f "${lint_file}" ]; then
        printf '# Write-without-read lint log\n\nAppend-only.\n\n' > "${lint_file}"
      fi
      printf -- '- [%s] project-pending: scripts/project-pending.sh not found or not executable\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" >> "${lint_file}"
    fi
  done
fi

# ---- 4b: route plain <!-- TASK --> blocks (existing behaviour, unchanged) -
if [ -n "${agent_text}" ] && printf '%s' "${agent_text}" | grep -q '<!-- TASK -->'; then
  tasks_found=$(printf '%s' "${agent_text}" | awk '
    BEGIN { RS = "<!-- /TASK -->"; ORS = "\n=====\n" }
    /<!-- TASK -->/ {
      sub(/.*<!-- TASK -->[[:space:]]*/, "", $0)
      if (length($0) > 4096) next
      print
    }
  ')

  printf '%s\n' "${tasks_found}" | awk -v RS="=====" '/^[[:space:]]*-[[:space:]]+\[[ xX]\][[:space:]]+/ {
    n = split($0, lines, "\n")
    for (i = 1; i <= n; i++) {
      line = lines[i]
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      if (line ~ /^-[[:space:]]+\[[ xX]\][[:space:]]+.+$/) {
        if (length(line) > 600) {
          line = substr(line, 1, 597) "..."
        }
        print line
        break
      }
    }
  }' | while IFS= read -r task_line; do
    [ -z "${task_line}" ] && continue

    target=""
    folder_match=$(printf '%s' "${task_line}" \
      | grep -oE '`folder:[0-9]{3}`' \
      | head -1 \
      | tr -d '`' \
      | cut -d: -f2)

    if [ -n "${folder_match}" ]; then
      if printf '%s' "${folder_match}" | grep -qE '^[0-9]{3}$'; then
        folder_dir=$(ls -d "${CLAUDE_PROJECT_DIR}/.claude/work/${folder_match}-"*/ 2>/dev/null | head -1)
        if [ -n "${folder_dir}" ]; then
          target="${folder_dir}tasks.md"
        fi
      fi
    fi

    if [ -z "${target}" ]; then
      target="${CLAUDE_PROJECT_DIR}/TASKS.md"
    fi

    if [ ! -f "${target}" ]; then
      if [ "${target##*/}" = "TASKS.md" ] && [ "$(dirname "${target}")" = "${CLAUDE_PROJECT_DIR}" ]; then
        printf '# Task list: cross-folder backlog\n\n' > "${target}" 2>/dev/null
      else
        folder_name=$(basename "$(dirname "${target}")")
        printf '# Tasks: %s\n\n' "${folder_name}" > "${target}" 2>/dev/null
      fi
    fi

    printf '%s\n' "${task_line}" >> "${target}" 2>/dev/null
  done

  task_count=$(printf '%s' "${tasks_found}" | grep -cE '^[[:space:]]*-[[:space:]]+\[[ xX]\]' || echo 0)
  if [ "${task_count:-0}" -gt 0 ]; then
    if [ "${task_count}" -eq 1 ]; then
      printf -- '- [%s] tasks: %s captured 1 task via TASK marker\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" "${agent:-unknown}" >> "${primary_log}" 2>/dev/null
    else
      printf -- '- [%s] tasks: %s captured %d tasks via TASK markers\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" "${agent:-unknown}" "${task_count}" >> "${primary_log}" 2>/dev/null
    fi
  fi
fi

# ---- 4c: route <!-- BACKPORT --> blocks -------------------------------------
# Distinct from <!-- TASK -->: matches only the literal string <!-- BACKPORT -->.
# Never matches <!-- TASK --> or <!-- /BACKPORT --> as an opener.
# Additive — the TASK regexes and RS values in 4a/4b above are untouched.
if [ -n "${agent_text}" ] && printf '%s' "${agent_text}" | grep -qF '<!-- BACKPORT -->'; then
  backport_helper="${CLAUDE_PROJECT_DIR}/scripts/record-backport.sh"
  _bp_lint_file="${CLAUDE_PROJECT_DIR}/lint.md"

  # Extract each BACKPORT block using awk. RS splits on <!-- /BACKPORT --> so
  # each record is one candidate block delimited by <!-- BACKPORT --> opener.
  # Print each block followed by a sentinel so the shell loop can parse fields.
  _bp_block_list=$(printf '%s' "${agent_text}" | awk '
    BEGIN { RS = "<!-- /BACKPORT -->"; ORS = "\n=====\n" }
    /<!-- BACKPORT -->/ {
      sub(/.*<!-- BACKPORT -->[[:space:]]*/, "", $0)
      if (length($0) > 4096) next
      print
    }
  ')

  # Parse each block and call the helper once per valid block.
  printf '%s\n' "${_bp_block_list}" | awk -v RS="=====" 'NF > 0 { print; print "---BPEND---" }' | {
    _bp_current=""
    while IFS= read -r _bp_line; do
      if [ "${_bp_line}" = "---BPEND---" ]; then
        # Parse accumulated block text for required fields.
        _bp_desc=""
        _bp_source=""
        _bp_priority=""
        _bp_note=""

        while IFS= read -r _parse_line; do
          # Description: first checkbox line.
          if [ -z "$_bp_desc" ]; then
            case "$_parse_line" in
              '- [ ] '*)
                _bp_desc="${_parse_line#'- [ ] '}"
                continue
                ;;
            esac
          fi
          # Source field (two-space or no indent).
          case "$_parse_line" in
            '  source: '*)
              _bp_source="${_parse_line#'  source: '}"
              continue
              ;;
            'source: '*)
              _bp_source="${_parse_line#'source: '}"
              continue
              ;;
          esac
          # Priority field.
          case "$_parse_line" in
            '  priority: '*)
              _bp_priority="${_parse_line#'  priority: '}"
              continue
              ;;
            'priority: '*)
              _bp_priority="${_parse_line#'priority: '}"
              continue
              ;;
          esac
          # Note field (optional).
          case "$_parse_line" in
            '  note: '*)
              _bp_note="${_parse_line#'  note: '}"
              continue
              ;;
            'note: '*)
              _bp_note="${_parse_line#'note: '}"
              continue
              ;;
          esac
        done <<< "$_bp_current"

        # Require all three fields; warn and skip on any missing.
        if [ -z "$_bp_desc" ] || [ -z "$_bp_source" ] || [ -z "$_bp_priority" ]; then
          if [ ! -f "${_bp_lint_file}" ]; then
            printf '# Write-without-read lint log\n\nAppend-only.\n\n' > "${_bp_lint_file}"
          fi
          printf -- '- [%s] backport: malformed BACKPORT block (missing description, source, or priority) — skipped\n' \
            "$(date '+%Y-%m-%d %H:%M:%S')" >> "${_bp_lint_file}"
          _bp_current=""
          continue
        fi

        # Call the helper with each field as a separate double-quoted argument
        # (Guard C: values never embedded in a format string).
        if [ -f "${backport_helper}" ] && [ -x "${backport_helper}" ]; then
          if bash "${backport_helper}" "${_bp_priority}" "${_bp_desc}" "${_bp_source}" "${_bp_note}" 2>/dev/null; then
            _bp_count=$(( _bp_count + 1 ))
          else
            if [ ! -f "${_bp_lint_file}" ]; then
              printf '# Write-without-read lint log\n\nAppend-only.\n\n' > "${_bp_lint_file}"
            fi
            printf -- '- [%s] backport: record-backport.sh failed for block — check priority value or source field\n' \
              "$(date '+%Y-%m-%d %H:%M:%S')" >> "${_bp_lint_file}"
          fi
        else
          if [ ! -f "${_bp_lint_file}" ]; then
            printf '# Write-without-read lint log\n\nAppend-only.\n\n' > "${_bp_lint_file}"
          fi
          printf -- '- [%s] backport: scripts/record-backport.sh not found or not executable\n' \
            "$(date '+%Y-%m-%d %H:%M:%S')" >> "${_bp_lint_file}"
        fi

        _bp_current=""
      else
        _bp_current="${_bp_current}${_bp_line}
"
      fi
    done

    # Log the total capture count for this turn (requirement 59).
    if [ "${_bp_count:-0}" -gt 0 ]; then
      if [ "${_bp_count}" -eq 1 ]; then
        printf -- '- [%s] backport: %s captured 1 candidate via BACKPORT marker\n' \
          "$(date '+%Y-%m-%d %H:%M:%S')" "${agent:-unknown}" >> "${primary_log}" 2>/dev/null
      else
        printf -- '- [%s] backport: %s captured %d candidates via BACKPORT markers\n' \
          "$(date '+%Y-%m-%d %H:%M:%S')" "${agent:-unknown}" "${_bp_count}" >> "${primary_log}" 2>/dev/null
      fi
    fi
  }
fi

exit 0
