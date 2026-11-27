#!/usr/bin/env bash
# pre-tool-use.sh: the team's safety gate.
#
# Runs before Bash and GitHub MCP tool calls. It does three things:
#   1. Hard-denies any action on the CLAUDE.md deny-list. Never overridable.
#   2. Allows an action pre-approved in the current work folder's brief.md,
#      under the "Approved GitHub actions" heading.
#   3. Otherwise stays silent, so Claude Code's normal permission prompt runs.
#
# The deny patterns below are anchored to command syntax (verbs and flags),
# not bare words. See docs/decisions/004-safety-hook-matching.md.

input=$(cat)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)

# Only gate Bash and GitHub MCP tools. Everything else falls through.
case "$tool_name" in
  Bash|mcp__github*) : ;;
  *) exit 0 ;;
esac

if [ "$tool_name" = "Bash" ]; then
  action=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
else
  action="$tool_name $(printf '%s' "$input" | jq -rc '.tool_input // {}' 2>/dev/null)"
fi

decision() {  # $1 = allow or deny, $2 = reason
  jq -nc --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  exit 0
}

# 1. The hard deny-list. These actions are never permitted.
#
# Before searching, build scan_text: a copy of the command with the content
# of quoted spans removed (so deny-list words inside commit messages and other
# arguments do not trigger false denials). Command verbs and flags are never
# quoted, so they survive the strip.
#
# For MCP tools, do not strip. Instead build scan_text from the tool name
# and the JSON keys only (not values), so a deny-list word inside a PR body
# or branch-name value does not trigger a false denial.

if [ "$tool_name" = "Bash" ]; then
  # Remove single-quoted spans ('...'), then double-quoted spans ("...").
  #
  # Python handles both cases robustly, via the _HOOK_ACTION environment
  # variable (avoids stdin contention with the pipe):
  #
  # 1. Single-quoted spans: 'content' — matched by a simple [^']* pattern.
  #    Single-quoted strings in shell cannot contain escaped single quotes,
  #    so no backslash handling is needed.
  #
  # 2. Double-quoted spans: "content" — the content may contain backslash-
  #    escaped double quotes (\") that must not be treated as span boundaries.
  #    The pattern (?:[^"\\]|\\.)* consumes either a non-quote non-backslash
  #    character, or a backslash followed by any character (including \"),
  #    so embedded \" sequences are absorbed into the span rather than
  #    closing it prematurely.
  #
  # 3. re.DOTALL makes . match newlines, so the pattern works correctly on
  #    multiline -m "..." commit messages in one pass, without needing the
  #    earlier tr newline trick.
  #
  # Command verbs and flags are never inside quoted spans, so they survive
  # the strip and remain visible to the deny-list grep.
  scan_text=$(_HOOK_ACTION="$action" python3 -c "
import sys, re, os
t = os.environ['_HOOK_ACTION']
t = re.sub(r\"'[^']*'\", ' ', t)
t = re.sub(r'\"(?:[^\"\\\\]|\\\\.)*\"', ' ', t, flags=re.DOTALL)
sys.stdout.write(t)
")
else
  # MCP path: tool name + JSON keys from .tool_input (not values).
  mcp_keys=$(printf '%s' "$input" \
    | jq -r '.tool_input | paths | join(".")' 2>/dev/null)
  if [ $? -ne 0 ] || [ -z "$mcp_keys" ]; then
    # Fail safe: if key extraction fails, scan the full action.
    scan_text="$action"
  else
    scan_text="$tool_name $mcp_keys"
  fi
fi

# Deny-list patterns, anchored to syntax.
# Force-push: --force, --force-with-lease, and the short -f flag (with or without
# other arguments between 'push' and '-f').
denylist='force.?push|push [^|]*--force|push [^|]*-f( |$)|push [^|]*--force-with-lease|push [^|]* \+[^ ]*'
# History rewrite
denylist="$denylist"'|filter-branch|filter-repo|reset [^|]*--hard|(^| )rebase( |$)'
# Branch removal.
# The ' :[^ /]' alternative (space before colon) catches the delete-by-empty-refspec
# syntax 'push origin :branch-name' without catching 'push origin HEAD:main', where
# the colon is not preceded by a space.
denylist="$denylist"'|branch [^|]*-[dD]( |$)|branch [^|]*--delete|push [^|]*--delete|push [^|]*-[dD]( |$)|push [^|]* :[^ /]|mcp__github__delete_branch'
# Repository removal (gh CLI and GitHub MCP server)
denylist="$denylist"'|repo delete|mcp__github__delete_repository'
# Visibility or transfer change (gh CLI and GitHub MCP server)
denylist="$denylist"'|--visibility|repo edit[^|]*visib|mcp__github__update_repository|mcp__github__transfer_repository'
# Branch-protection edits (path segment, literal key, and GitHub MCP server tool names)
denylist="$denylist"'|branches/[^|]*/protection|branch_protection|mcp__github__update_branch_protection|mcp__github__set_branch_protection'
# Collaborator changes (path segment, named subcommands, and GitHub MCP server tool names).
# 'repo collaborator' matches the gh CLI form 'gh repo collaborator add/remove'.
denylist="$denylist"'|add-collaborator|remove-collaborator|repo collaborator|/collaborators|mcp__github__add_collaborator|mcp__github__remove_collaborator'
# Release removal (gh CLI and GitHub MCP server)
denylist="$denylist"'|release delete|mcp__github__delete_release'
# Disable scanning (gh CLI and GitHub MCP server)
denylist="$denylist"'|disable[^|]*scan|scanning[^|]*disable|mcp__github__disable_secret_scanning|mcp__github__disable_code_scanning'

if printf '%s' "$scan_text" | grep -qiE "$denylist"; then
  decision deny "Blocked by the hard deny-list in CLAUDE.md. Force-push, branch or repository deletion, history rewrite, visibility or branch-protection change, collaborator change, release deletion, and disabling scanning are never permitted."
fi

# Also scan the raw action for deny-list patterns that bypass quoting.
# These patterns are tightly anchored to flag syntax; they cannot fire on
# commit messages because commit messages follow -m and are not git push/branch/reset/rebase calls.
raw_denylist='push [^|]*['"'"'"]--force['"'"'"]|push [^|]*['"'"'"]-f['"'"'"]( |$)|bash[^|]*-c[^|]*(push[^|]*--force|push[^|]*-f )'
if printf '%s' "$action" | grep -qiE "$raw_denylist"; then
  decision deny "Blocked by the hard deny-list in CLAUDE.md. Force-push, branch or repository deletion, history rewrite, visibility or branch-protection change, collaborator change, release deletion, and disabling scanning are never permitted."
fi

# 2. Pre-approved actions in the current work folder's brief.
#
# The hook holds a fixed dictionary that maps each known brief checklist
# phrase to a command pattern (extended regex). Only ticked lines ([x] or [X])
# in the brief are considered. A phrase not in the dictionary pre-approves
# nothing. See docs/decisions/004-safety-hook-matching.md.
#
# Dictionary: keys are lower-cased brief phrases; values are regexes tested
# against $action (the original command, not scan_text).
#
# key[0] .. key[5] and pat[0] .. pat[5] are parallel arrays.

key[0]="create a branch"
pat[0]='(^| )git (branch [^- ][^ ]*|checkout -b|switch -c)( |$)|mcp__github__create_branch'

key[1]="commit to a branch"
pat[1]='(^| )git( -C "[^"]*")? commit( |$)|mcp__github__create_or_update_file|mcp__github__push_files'

key[2]="push a branch other than the main branch"
pat[2]='(^| )git( -C "[^"]*")? push( |$)'

key[3]="open a pull request"
pat[3]='(^| )gh pr create( |$)|mcp__github__create_pull_request'

key[4]="comment on a pull request or an issue"
pat[4]='(^| )gh (pr|issue) comment( |$)|mcp__github__add_issue_comment'

key[5]="create an issue"
pat[5]='(^| )gh issue create( |$)|mcp__github__create_issue'

# Exclusion: a git push targeting main or master must not be pre-approved.
# Patterns cover:
#   push <remote> main|master           (plain branch name)
#   push <remote> <src>:<main|master>   (refspec with explicit target, e.g. HEAD:main)
#   push <remote>:<main|master>         (colon-joined remote:branch shorthand)
#   push <remote>:?HEAD:<main|master>   (colon-joined HEAD shorthand)
_pushes_main() {
  local cmd="$1"
  printf '%s' "$cmd" | grep -qiE \
    'push [^ ]* ["\x27]?(main|master)["\x27]?( |$)|push [^ ]* [^ ]*:["\x27]?(main|master)["\x27]?( |$)|push [^ ]*:["\x27]?(main|master)["\x27]?( |$)|push [^ ]*:?HEAD:["\x27]?(main|master)["\x27]?( |$)'
}

work_dir="$CLAUDE_PROJECT_DIR/.claude/work"

# Locate the active work folder using the path-index first (.current as fallback).
#
# The path-index (.claude/work/.path-index) maps folder names to repo paths.
# We find all folders registered for the current repo root, then pick the one
# whose log.md was most recently modified (mtime tiebreaker). This mirrors the
# routing logic in subagent-stop.sh and post-tool-use.sh.
# If the path-index yields nothing, fall back to .current as before.
current_id=""
path_index="$work_dir/.path-index"
if [ -f "$path_index" ]; then
  norm_proj=$(realpath "$CLAUDE_PROJECT_DIR" 2>/dev/null || printf '%s' "$CLAUDE_PROJECT_DIR")
  norm_proj="${norm_proj%/}"
  best_mt=0
  # Deduplicate: last entry per folder-name wins. Skip comments and blank lines.
  deduped=$(awk '
    /^[[:space:]]*#/ { next }
    NF == 2 { last[$1] = $2 }
    END { for (f in last) print f, last[f] }
  ' "$path_index" 2>/dev/null)
  while IFS=' ' read -r fname rpath; do
    [ -z "$fname" ] || [ -z "$rpath" ] && continue
    # Validate folder slug (path-traversal defence).
    case "$fname" in
      [0-9][0-9][0-9]-*) : ;;
      *) continue ;;
    esac
    [ -d "$work_dir/$fname" ] || continue
    norm_rpath=$(realpath "$rpath" 2>/dev/null || printf '%s' "$rpath")
    norm_rpath="${norm_rpath%/}"
    [ "$norm_rpath" = "$norm_proj" ] || continue
    logf="$work_dir/$fname/log.md"
    [ -f "$logf" ] || continue
    mt=$(stat -f '%m' "$logf" 2>/dev/null \
      || stat -c '%Y' "$logf" 2>/dev/null \
      || echo 0)
    if [ "$mt" -gt "$best_mt" ] 2>/dev/null; then
      best_mt="$mt"
      current_id="$fname"
    fi
  done <<< "$deduped"
fi

# Fall back to .current if the path-index lookup yielded nothing.
if [ -z "$current_id" ] && [ -f "$work_dir/.current" ]; then
  current_id=$(cat "$work_dir/.current" 2>/dev/null)
fi

brief="$work_dir/$current_id/brief.md"
if [ -n "$current_id" ] && [ -f "$brief" ]; then
    approved=$(awk 'tolower($0) ~ /^#+ *approved github actions/{f=1;next} /^#+ /{f=0} f' "$brief")
    while IFS= read -r line; do
      # Keep only ticked lines: list marker then [x] or [X].
      ticked=$(printf '%s' "$line" | grep -iE '^[[:space:]]*[-*][[:space:]]*\[[xX]\]')
      [ -z "$ticked" ] && continue
      # Extract the phrase: strip list marker and checkbox, trim whitespace,
      # lower-case.
      phrase=$(printf '%s' "$line" \
        | sed -E 's/^[[:space:]]*[-*][[:space:]]*//' \
        | sed -E 's/^\[[xX]\][[:space:]]*//' \
        | sed -E 's/[[:space:]]+$//' \
        | tr '[:upper:]' '[:lower:]')
      [ -z "$phrase" ] && continue
      # Look the phrase up in the dictionary.
      matched_pat=""
      for i in 0 1 2 3 4 5; do
        if [ "$phrase" = "${key[$i]}" ]; then
          matched_pat="${pat[$i]}"
          break
        fi
      done
      [ -z "$matched_pat" ] && continue
      # Test the dictionary regex against the original action.
      if printf '%s' "$action" | grep -qiE "$matched_pat"; then
        # For "push a branch other than the main branch", apply the exclusion.
        if [ "$i" -eq 2 ] && _pushes_main "$action"; then
          continue
        fi
        decision allow "Pre-approved in the brief for work folder $current_id."
      fi
    done <<< "$approved"
fi

# 3. Not deny-listed, not pre-approved: fall through to the normal prompt.
exit 0
