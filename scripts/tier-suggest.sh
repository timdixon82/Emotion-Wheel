#!/usr/bin/env bash
# tier-suggest.sh: suggest the risk tier for a change from its diff.
#
# Decision 023 routes work by risk tier. This script makes the tier check
# repeatable: it reads the files and added lines a branch changes, and prints
# the lowest tier the change can safely have, with the reasons. Sonja runs it
# before choosing reviewers and again at the merge gate; if the suggestion is
# higher than the tier in the brief, the work moves up a tier.
#
# Usage:
#   bash scripts/tier-suggest.sh [base-ref] [repo-dir]
#     base-ref  defaults to origin/main, then main
#     repo-dir  defaults to the current directory
#   bash scripts/tier-suggest.sh --files <file>...   # classify paths only
#
# Output (plain text, one item per line):
#   Tier: <0|1|2>
#   - <reason>
#
# Exit codes: 0 success, 2 no diff could be computed.

set -u

paths=""
added=""

if [ "${1:-}" = "--files" ]; then
  shift
  paths=$(printf '%s\n' "$@")
else
  base="${1:-}"
  repo="${2:-.}"
  if [ -z "$base" ]; then
    if git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
      base="origin/main"
    else
      base="main"
    fi
  fi
  paths=$(git -C "$repo" diff --name-only "$base...HEAD" 2>/dev/null) || {
    echo "tier-suggest.sh: cannot diff against $base." >&2; exit 2; }
  # Added lines from code and config only: prose in docs mentions secrets
  # and passwords without handling them.
  added=$(git -C "$repo" diff -U0 "$base...HEAD" -- . ':(exclude)*.md' ':(exclude)docs/**' \
    ':(exclude).claude/work/**' 2>/dev/null | grep -E '^\+[^+]' || true)
fi

tier=0
reasons=()

_raise() {
  # _raise <tier> <reason>
  [ "$1" -gt "$tier" ] && tier="$1"
  reasons+=("$1|$2")
}

if [ -z "$paths" ]; then
  echo "Tier: 0"
  echo "- No changed files."
  exit 0
fi

while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$p" in
    .github/workflows/*|templates/.github/workflows/*)
      _raise 2 "Workflow changed: $p" ;;
    .claude/settings*.json|.claude/hooks/pre-tool-use.sh|.gitleaks.toml|.github/dependabot.yml)
      _raise 2 "Safety or permission config changed: $p" ;;
    .claude/work/*|*.md|*.txt|LICENSE|docs/*)
      # Agent and command files are behaviour config, not plain docs.
      case "$p" in
        .claude/agents/*|.claude/commands/*|.claude/output-styles/*)
          _raise 1 "Agent behaviour file changed: $p" ;;
      esac
      ;;
    *auth*|*login*|*password*|*payment*|*checkout*|*secret*|*.env|*.env.*|*credential*)
      _raise 2 "Sensitive file name: $p" ;;
    *)
      _raise 1 "Code or config changed: $p" ;;
  esac
done <<< "$paths"

# Added lines that suggest personal data, secrets or network calls.
if [ -n "$added" ]; then
  hits=$(printf '%s\n' "$added" \
    | grep -inE 'password|passwd|api[_-]?key|secret|bearer |private[_-]?key|document\.cookie|localStorage\.setItem\(.*(email|name|phone|address)|navigator\.geolocation|<form[ >]|permissions:|GITHUB_TOKEN|pull_request_target' \
    | head -5 || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      _raise 2 "Sensitive pattern in added line: $(printf '%s' "$h" | cut -c1-120)"
    done <<< "$hits"
  fi
fi

[ "${#reasons[@]}" -eq 0 ] && reasons+=("0|Only docs, wiki or work-folder files changed.")

echo "Tier: $tier"
# Highest-tier reasons first, at most 10, to keep the output short.
printf '%s\n' "${reasons[@]}" | sort -t'|' -k1,1nr -s | head -10 | cut -d'|' -f2- | sed 's/^/- /'
