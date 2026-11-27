#!/usr/bin/env bash
# record-backport.sh: validate and append a backport candidate entry to
# .claude/backport-candidates.md in the current project repository.
#
# Synced to project repos via SCRIPTS_MANIFEST — runs in project sessions only.
#
# Usage:
#   scripts/record-backport.sh <priority> <description> <source> [<note>]
#
# Arguments:
#   priority    — must be one of: high, medium, low
#   description — short plain-text description of the candidate
#   source      — file path with optional line reference (e.g. docs/foo.md:42)
#   note        — (optional) free-text sentence giving more context
#
# On success: appends one entry to .claude/backport-candidates.md and exits 0.
# On failure: writes a warning to stderr (and to lint.md if CLAUDE_PROJECT_DIR
#             is set), and exits non-zero.

set -euo pipefail

priority="${1:-}"
description="${2:-}"
source_ref="${3:-}"
note="${4:-}"

lint_file="${CLAUDE_PROJECT_DIR:-}/lint.md"

_warn() {
  printf '%s\n' "$1" >&2
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    if [ ! -f "${lint_file}" ]; then
      printf '# Write-without-read lint log\n\nAppend-only.\n\n' > "${lint_file}"
    fi
    printf -- '- [%s] record-backport: %s\n' \
      "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "${lint_file}"
  fi
}

# ── Validate arguments ────────────────────────────────────────────────────────

if [ -z "$priority" ] || [ -z "$description" ] || [ -z "$source_ref" ]; then
  _warn "record-backport.sh: missing required argument (priority, description, or source)"
  exit 1
fi

# Priority allow-list — strictly one of: high, medium, low.
case "$priority" in
  high|medium|low) : ;;
  *)
    _warn "record-backport.sh: invalid priority '$priority' — must be high, medium, or low"
    exit 1
    ;;
esac

# Source field must not contain shell-special characters that could enable
# injection if the value is later used in a shell context.
case "$source_ref" in
  *'`'* | *'$'* | *';'* | *'|'* | *'>'* | *'<'* | *'&'*)
    _warn "record-backport.sh: source field contains disallowed characters: $source_ref"
    exit 1
    ;;
esac

# ── Resolve candidates file path ─────────────────────────────────────────────

if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
  printf '%s\n' "record-backport.sh: CLAUDE_PROJECT_DIR is not set" >&2
  exit 1
fi

candidates_file="${CLAUDE_PROJECT_DIR}/.claude/backport-candidates.md"

# ── Create file if absent ─────────────────────────────────────────────────────

if [ ! -f "$candidates_file" ]; then
  # Read project prefix from .claude/project-prefix; fall back to repo dir name.
  prefix_file="${CLAUDE_PROJECT_DIR}/.claude/project-prefix"
  if [ -f "$prefix_file" ]; then
    project_label="$(tr -d '[:space:]' < "$prefix_file" 2>/dev/null || true)"
  fi
  if [ -z "${project_label:-}" ]; then
    project_label="$(basename "$CLAUDE_PROJECT_DIR")"
  fi
  printf '# Backport candidates for %s\n\n' "$project_label" > "$candidates_file"
fi

# ── Append entry ──────────────────────────────────────────────────────────────
# Use printf '%s' with each value as a separate data argument.
# Never embed description, source_ref, or note in a format string.

{
  printf -- '- [ ] %s\n' "$description"
  printf '  source: %s\n' "$source_ref"
  printf '  priority: %s\n' "$priority"
  if [ -n "$note" ]; then
    printf '  note: %s\n' "$note"
  fi
  printf '\n'
} >> "$candidates_file"
