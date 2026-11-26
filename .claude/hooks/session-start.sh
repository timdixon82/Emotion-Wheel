#!/usr/bin/env bash
# session-start.sh: prints a short context summary when a session begins:
# the project, work folders touched in the last 7 days, and the wiki status.

cat > /dev/null  # consume and ignore the SessionStart JSON on stdin

proj="$CLAUDE_PROJECT_DIR"
echo "Agent team session. Project: $(basename "$proj")."

# Sync check: scoped to THIS session's active project only.
#
# If this session is inside a scaffolded or isolated project (it carries a
# .claude/template-version stamp), compare only this project against the
# team template master and tell Sonja whether a sync is due for it.
# This never syncs any other project; sync-all-projects.sh is the deliberate
# team-root action for that. The hook never edits files; it only surfaces
# the prompt so Sonja can ask Tim at the top of the session.
#
# Master location uses 4-layer resolution:
#   1. $AGENTTEAM_MASTER env var
#   2. Validated .claude/template-master stamp (must be absolute, no bad chars,
#      must be an existing dir whose CLAUDE.md H1 names "Claude Agent Team")
#   3. Sibling probe: <project_parent>/AgentTeam
#   4. Hard-coded default /Users/timdixon/Code/AgentTeam
#
# Jed security finding 3: template-master path is validated; if the resolved
# master is not an existing directory, print "master path invalid" instead of
# emitting a command that interpolates an unvalidated path.
#
# Jacob finding 4: distinguish "MASTER UNREACHABLE" from "in sync".
# Jacob finding 2: check sha256 parity of pre-tool-use.sh, not just version.

_session_validate_path() {
  # Returns 0 for a safe absolute path; 1 otherwise.
  local p="$1"
  case "$p" in /*) ;; *) return 1 ;; esac
  case "$p" in *[[:space:]]* | *'"'* | *'$'* | *'`'* | *';'*) return 1 ;; esac
  return 0
}

_session_is_team_root() {
  local dir="$1"
  [ -f "$dir/CLAUDE.md" ] || return 1
  grep -qE '^# Claude Agent Team' "$dir/CLAUDE.md"
}

tv_file="$proj/.claude/template-version"
if [ -f "$tv_file" ]; then

  # ── Layer 1: environment variable ─────────────────────────────────────────
  master=""
  if [ -n "${AGENTTEAM_MASTER:-}" ]; then
    if _session_validate_path "$AGENTTEAM_MASTER" \
        && [ -d "$AGENTTEAM_MASTER" ] \
        && _session_is_team_root "$AGENTTEAM_MASTER"; then
      master="$AGENTTEAM_MASTER"
    fi
  fi

  # ── Layer 2: template-master stamp ────────────────────────────────────────
  if [ -z "$master" ] && [ -f "$proj/.claude/template-master" ]; then
    raw="$(tr -d '\n\r' < "$proj/.claude/template-master")"
    if _session_validate_path "$raw" && [ -d "$raw" ] && _session_is_team_root "$raw"; then
      master="$raw"
    fi
  fi

  # ── Layer 3: sibling probe ─────────────────────────────────────────────────
  if [ -z "$master" ]; then
    parent="$(cd "$proj/.." 2>/dev/null && pwd)" || parent=""
    if [ -n "$parent" ]; then
      sibling="$parent/AgentTeam"
      if [ -d "$sibling" ] && _session_is_team_root "$sibling"; then
        master="$sibling"
      fi
    fi
  fi

  # ── Layer 4: hard-coded default ───────────────────────────────────────────
  [ -z "$master" ] && master="/Users/timdixon/Code/AgentTeam"

  # ── Check master is a valid existing directory ────────────────────────────
  if [ ! -d "$master" ]; then
    echo "master path invalid, skipping sync check."
  else
    # Guard: when this session IS the master, self-sync is meaningless.
    _proj_real=$(realpath "$proj" 2>/dev/null || printf '%s' "$proj")
    _master_real=$(realpath "$master" 2>/dev/null || printf '%s' "$master")
    if [ "$_proj_real" = "$_master_real" ]; then
      : # This session is the master itself — sync check not applicable.
    else
    proj_v="$(cat "$tv_file" 2>/dev/null || echo unknown)"
    master_v="$(cat "$master/VERSION" 2>/dev/null || true)"

    if [ -z "$master_v" ]; then
      echo "MASTER UNREACHABLE: cannot read VERSION from $master."
    elif [ "$proj_v" = "unknown" ]; then
      echo "MASTER UNREACHABLE: cannot read template-version from $tv_file."
    elif [ "$proj_v" != "$master_v" ]; then
      echo "SYNC DUE: this project was scaffolded from template $proj_v; master is now $master_v."
      echo "  Run the team repository's copy, not this project's own: bash \"$master/scripts/sync-from-template.sh\" \"$master\" \"$proj\""
    else
      echo "Template: in sync ($proj_v)."
    fi
    # ── sha256 parity check: detect silent local modification of the gate ───
    sha_file="$proj/.claude/template-hook-sha256"
    if [ -f "$sha_file" ]; then
      expected_sha="$(tr -d '\n\r' < "$sha_file")"
      chook="$proj/.claude/hooks/pre-tool-use.sh"
      if [ -f "$chook" ] && [ -n "$expected_sha" ]; then
        if command -v sha256sum >/dev/null 2>&1; then
          actual_sha="$(sha256sum "$chook" | cut -d' ' -f1)"
        else
          actual_sha="$(shasum -a 256 "$chook" | cut -d' ' -f1)"
        fi
        if [ "$actual_sha" != "$expected_sha" ]; then
          echo "WARNING: safety hook sha256 mismatch — pre-tool-use.sh may have been locally modified."
          echo "  Expected: $expected_sha"
          echo "  Actual:   $actual_sha"
          echo "  Run the team repository's copy to restore byte parity: bash \"$master/scripts/sync-from-template.sh\" \"$master\" \"$proj\""
        fi
      fi
    fi

    # ── Pending tasks from AgentTeam (ADR-032-4, ADR-032-5) ─────────────────
    # Guard 1: master is already validated above (we are inside the `else`
    # branch of `if [ ! -d "$master" ]`). Read only here, never before.
    #
    # Guard 2: validate prefix for shape and characters before building path.
    # Guard 3: read-only; print descriptions via printf '%s\n' — never source,
    # eval, or let shell-interpolate file contents.
    _pending_prefix_file="$proj/.claude/project-prefix"
    if [ -f "$_pending_prefix_file" ]; then
      _pending_prefix="$(tr -d '[:space:]' < "$_pending_prefix_file" 2>/dev/null || true)"
      # Validate: must be 2-4 uppercase letters only (path-traversal guard).
      if [ -n "$_pending_prefix" ] && printf '%s' "$_pending_prefix" | grep -qE '^[A-Z][A-Z0-9]{1,5}$'; then
        _pending_file="$master/outputs/project-pending/${_pending_prefix}.md"
        if [ -f "$_pending_file" ]; then
          # Count open entries. grep -c exits 1 with no matches — handle that.
          _pending_count=$(grep -cE '^- \[ \]' "$_pending_file" 2>/dev/null || true)
          if [ "${_pending_count:-0}" -gt 0 ]; then
            printf 'Pending tasks from AgentTeam (%d item(s)):\n' "$_pending_count"
            # Strip "- [ ] " prefix and all inline tags. Print each description
            # as literal text via printf '%s\n' (never unquoted echo or printf "$desc").
            while IFS= read -r _pending_raw; do
              case "$_pending_raw" in
                '- [ ] '*) : ;;
                *) continue ;;
              esac
              # Strip the leading "- [ ] ".
              _pending_desc="${_pending_raw#'- [ ] '}"
              # Strip all inline backtick tags from the end.
              while printf '%s' "$_pending_desc" | grep -qE '[[:space:]]+`[a-z-]+:[^`]+`[[:space:]]*$'; do
                _pending_desc="$(printf '%s' "$_pending_desc" | sed 's/[[:space:]]*`[a-z-][^`]*`[[:space:]]*$//')"
              done
              printf '  - %s\n' "$_pending_desc"
            done < "$_pending_file"
          fi
        fi
      fi
    fi
    # ── End pending tasks check ──────────────────────────────────────────────
    fi # end self-guard (ADR-sync-self): sha256 and pending tasks skipped at master
  fi

fi

# ── Backport candidates from external projects (ADR-033-1 to ADR-033-6) ─────
#
# Pull model: AgentTeam reads .claude/backport-candidates.md from each
# external project path listed in the path-index. Projects never write here.
#
# Five guards (ADR-033-5):
#   A — validate each repo path with _session_validate_path and -d test.
#   B — the only variable segment in the constructed file path is the
#       validated repo path; the suffix /.claude/backport-candidates.md
#       is a fixed literal with no untrusted token.
#   C — read-only; descriptions are printed via printf '%s\n' with the
#       value as a separate data argument — never source, eval, or
#       printf "$desc".
#   D — cap at 10 pending entries per project to bound startup cost.
#   E — deduplicate on repo path and exclude the AgentTeam root before
#       any file is opened (both filters run before the read loop).
#
# This block sits outside the template-stamp gate (ADR-033-6): the
# AgentTeam root reads the path-index regardless of any template stamp.
{
  _bp_index="${proj}/.claude/work/.path-index"
  if [ -f "$_bp_index" ]; then
    # Normalise the AgentTeam root path for exclusion (Guard E).
    _bp_self=$(realpath "$proj" 2>/dev/null || printf '%s' "$proj")
    _bp_self="${_bp_self%/}"

    # Extract the repo-path column (field 2), skip comment and blank lines,
    # require exactly 2 fields (Guard: malformed lines skipped).
    # Deduplicate on repo path (Guard E): last occurrence per path wins.
    _bp_unique_paths=$(awk '
      /^[[:space:]]*#/ { next }
      NF == 2 { last[$2] = $2 }
      END { for (p in last) print last[p] }
    ' "$_bp_index" 2>/dev/null || true)

    _bp_found_any=false
    _bp_output=""

    while IFS= read -r _bp_rpath; do
      [ -z "$_bp_rpath" ] && continue

      # Guard E: exclude the AgentTeam root itself.
      _bp_norm=$(realpath "$_bp_rpath" 2>/dev/null || printf '%s' "$_bp_rpath")
      _bp_norm="${_bp_norm%/}"
      [ "$_bp_norm" = "$_bp_self" ] && continue

      # Guard A: validate path shape (no whitespace, quotes, $, backtick, ;).
      _session_validate_path "$_bp_norm" || continue

      # Guard A: must be an existing directory.
      [ -d "$_bp_norm" ] || continue

      # Guard B: the only variable segment is the validated _bp_norm.
      _bp_candidates="${_bp_norm}/.claude/backport-candidates.md"
      [ -f "$_bp_candidates" ] || continue

      # Filter for open entries only (^- \[ \]).
      # Guard D: cap at 10 entries per project.
      _bp_entries=$(grep -E '^- \[ \] ' "$_bp_candidates" 2>/dev/null \
        | head -10 || true)
      [ -z "$_bp_entries" ] && continue

      _bp_count=$(printf '%s\n' "$_bp_entries" | grep -c '^- \[ \] ' 2>/dev/null || true)
      _bp_project_name=$(basename "$_bp_norm")

      _bp_found_any=true
      # Guard C: print descriptions via printf '%s\n' with value as data arg.
      printf 'Backport candidates from %s (%d item(s)):\n' \
        "$_bp_project_name" "${_bp_count:-0}"
      while IFS= read -r _bp_entry; do
        [ -z "$_bp_entry" ] && continue
        _bp_desc="${_bp_entry#'- [ ] '}"
        printf '  - %s\n' "$_bp_desc"
      done <<< "$_bp_entries"

    done <<< "$_bp_unique_paths"
  fi
} 2>/dev/null || true
# ── End backport candidates check ────────────────────────────────────────────

work_dir="$proj/.claude/work"
if [ -d "$work_dir" ]; then
  recent=$(find "$work_dir" -mindepth 1 -maxdepth 1 -type d -mtime -7 2>/dev/null)
  if [ -n "$recent" ]; then
    echo "Work folders active in the last 7 days:"
    while IFS= read -r d; do
      [ -n "$d" ] && echo "  - $(basename "$d")"
    done <<< "$recent"
  else
    echo "No work folders active in the last 7 days."
  fi
else
  echo "No work folders yet."
fi

log="$proj/docs/log.md"
if [ -f "$log" ]; then
  last=$(grep -E '^## \[' "$log" 2>/dev/null | tail -1)
  [ -n "$last" ] && echo "Global wiki, last operation: ${last#'## '}"
fi

# Print the next free Q-number so Sonja always sees it at session start
# and cannot assign a low or stale number by accident.
next_q_script="$proj/scripts/next-q.sh"
if [ -f "$next_q_script" ] && [ -x "$next_q_script" ]; then
  next_q=$(bash "$next_q_script" 2>/dev/null)
  [ -n "$next_q" ] && echo "Next free Q-number: $next_q"
fi

# Surface overdue tasks only when there are any (Decision 023: event-driven,
# replaces the weekly manual `tasks.sh --aged` run). Prints nothing when none.
tasks_script="$proj/scripts/tasks.sh"
if [ -f "$tasks_script" ]; then
  aged_count=$(bash "$tasks_script" --aged 2>/dev/null | grep -c '^\[' || true)
  if [ "${aged_count:-0}" -gt 0 ]; then
    echo "Overdue tasks: ${aged_count}. Run: bash scripts/tasks.sh --aged"
  fi
fi

# Refresh outputs/status.html so Tim always sees a current dashboard at
# session open. Run the script only if it exists and is executable.
# Any failure is silently discarded; the session is never blocked.
status_script="$proj/scripts/status.sh"
if [ -f "$status_script" ] && [ -x "$status_script" ]; then
  "$status_script" >/dev/null 2>&1 || true
fi

exit 0
