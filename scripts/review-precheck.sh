#!/usr/bin/env bash
# review-precheck.sh: the mechanical part of a code review, as a script.
#
# Decision 023: anything a reviewer would check by pattern is checked here,
# the same way every time, so agents spend tokens only on judgement. Sean runs
# it before opening a pull request and pastes the output into the description;
# the Tier 1 reviewer reads that output and investigates only the FLAG lines
# and what a script cannot judge.
#
# Usage:
#   bash scripts/review-precheck.sh [base-ref] [repo-dir]
#     base-ref  defaults to origin/main, then main
#     repo-dir  defaults to the current directory
#
# Output: one line per check, "PASS <check>" or "FLAG <check>: <detail>",
# then "Result: <n> flag(s)." Plain text, screen-reader friendly.
#
# Exit codes: 0 no flags, 1 one or more flags, 2 no diff could be computed.

set -u

base="${1:-}"
repo="${2:-.}"
if [ -z "$base" ]; then
  if git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
    base="origin/main"
  else
    base="main"
  fi
fi

changed=$(git -C "$repo" diff --name-only --diff-filter=ACMR "$base...HEAD" 2>/dev/null) || {
  echo "review-precheck.sh: cannot diff against $base." >&2; exit 2; }

flags=0

_pass() { echo "PASS $1"; }
_flag() { echo "FLAG $1: $2"; flags=$((flags + 1)); }

# Added lines for a set of pathspecs, prefixed "file:+line" for context.
_added() {
  git -C "$repo" diff -U0 "$base...HEAD" -- "$@" 2>/dev/null | awk '
    /^\+\+\+ b\// { file = substr($0, 7); next }
    /^\+[^+]/     { print file ":" substr($0, 2) }'
}

_check_lines() {
  # _check_lines <name> <regex> <pathspec>...
  local name="$1" regex="$2"; shift 2
  local hits
  hits=$(_added "$@" | grep -E "$regex" | head -5 || true)
  if [ -n "$hits" ]; then
    _flag "$name" "$(printf '%s' "$hits" | head -1 | cut -c1-140) ($(printf '%s\n' "$hits" | wc -l | tr -d ' ') line(s))"
  else
    _pass "$name"
  fi
}

if [ -z "$changed" ]; then
  echo "No changed files against $base."
  echo "Result: 0 flag(s)."
  exit 0
fi

echo "Review precheck against $base: $(printf '%s\n' "$changed" | wc -l | tr -d ' ') file(s) changed."

# ── Secrets ──────────────────────────────────────────────────────────────────
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks git --no-banner --redact --log-opts="$base..HEAD" "$repo" >/dev/null 2>&1; then
    _pass "secrets (gitleaks)"
  else
    _flag "secrets (gitleaks)" "gitleaks reported a finding; run: gitleaks git --redact --log-opts=$base..HEAD"
  fi
else
  _check_lines "secrets (pattern scan, gitleaks not installed)" \
    '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-|(password|passwd|api_?key|secret)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,})' .
fi

# ── Unsafe DOM and code execution ───────────────────────────────────────────
_check_lines "unsafe HTML injection or eval" \
  '(\.innerHTML[[:space:]]*\+?=|\.outerHTML[[:space:]]*=|insertAdjacentHTML|document\.write\(|[^.[:alnum:]_]eval\(|new Function\()' \
  '*.js' '*.mjs' '*.ts' '*.tsx' '*.jsx' '*.html' '*.php'

# ── Dependencies ─────────────────────────────────────────────────────────────
pkg_changed=$(printf '%s\n' "$changed" | grep -E '(^|/)package\.json$' || true)
if [ -n "$pkg_changed" ]; then
  missing=""
  while IFS= read -r pj; do
    dir=$(dirname "$pj")
    lock="$dir/package-lock.json"; [ "$dir" = "." ] && lock="package-lock.json"
    printf '%s\n' "$changed" | grep -qxF "$lock" || missing="$missing $pj"
  done <<< "$pkg_changed"
  if [ -n "$missing" ]; then
    _flag "lockfile updated with package.json" "no lockfile change for:$missing"
  else
    _pass "lockfile updated with package.json"
  fi
  _check_lines "unpinned dependency range" '"[^"]+":[[:space:]]*"(\^|~|\*|>|latest)' '*package.json'
else
  _pass "dependencies unchanged"
fi

# ── Workflows and permissions ────────────────────────────────────────────────
wf=$(printf '%s\n' "$changed" | grep -E '(^|/)\.github/workflows/' || true)
if [ -n "$wf" ]; then
  _flag "workflow changed (Tier 2)" "$(printf '%s' "$wf" | tr '\n' ' ')"
  _check_lines "action not pinned to a full commit SHA" 'uses:[[:space:]]*[^@[:space:]]+@([^0-9a-f]|[0-9a-f]{1,39}([^0-9a-f]|$))' '*.yml' '*.yaml'
else
  _pass "workflows unchanged"
fi

# ── Accessibility patterns in markup and styles ──────────────────────────────
img_hits=$(_added '*.html' '*.php' '*.jsx' '*.tsx' | grep -iE '<img[^>]*>' | grep -viE 'alt=' | head -3 || true)
if [ -n "$img_hits" ]; then _flag "img without alt" "$(printf '%s' "$img_hits" | head -1 | cut -c1-140)"; else _pass "img without alt"; fi
_check_lines "positive tabindex" 'tabindex=["'"'"']?[1-9]' '*.html' '*.php' '*.jsx' '*.tsx' '*.js'
_check_lines "click handler on a non-interactive element" '<(div|span|li|td)[^>]*on[Cc]lick' '*.html' '*.php' '*.jsx' '*.tsx'
_check_lines "focus outline removed" 'outline:[[:space:]]*(none|0)([[:space:]]*;|[[:space:]]*$)' '*.css' '*.scss'
blank_hits=$(_added '*.html' '*.php' '*.jsx' '*.tsx' | grep -E 'target=["'"'"']_blank' | grep -v 'noopener' | head -3 || true)
if [ -n "$blank_hits" ]; then _flag "target=_blank without rel=noopener" "$(printf '%s' "$blank_hits" | head -1 | cut -c1-140)"; else _pass "target=_blank without rel=noopener"; fi

# ── Shell scripts ────────────────────────────────────────────────────────────
sh_files=$(printf '%s\n' "$changed" | grep -E '\.sh$' || true)
if [ -n "$sh_files" ]; then
  bad=""
  while IFS= read -r s; do
    [ -f "$repo/$s" ] || continue
    bash -n "$repo/$s" 2>/dev/null || bad="$bad $s"
  done <<< "$sh_files"
  if [ -n "$bad" ]; then _flag "bash syntax" "$bad"; else _pass "bash syntax"; fi
  if command -v shellcheck >/dev/null 2>&1; then
    sc_bad=""
    while IFS= read -r s; do
      [ -f "$repo/$s" ] || continue
      shellcheck --severity=warning "$repo/$s" >/dev/null 2>&1 || sc_bad="$sc_bad $s"
    done <<< "$sh_files"
    if [ -n "$sc_bad" ]; then _flag "shellcheck (warning)" "$sc_bad"; else _pass "shellcheck (warning)"; fi
  else
    echo "SKIP shellcheck (not installed)"
  fi
fi

# ── Tests touched alongside code ─────────────────────────────────────────────
code=$(printf '%s\n' "$changed" | grep -E '\.(js|mjs|ts|tsx|jsx|php|py|sh)$' | grep -viE '(^|/)(test|tests|__tests__|spec)/|\.(test|spec)\.' || true)
tests=$(printf '%s\n' "$changed" | grep -iE '(^|/)(test|tests|__tests__|spec)/|\.(test|spec)\.|(^|/)test-[^/]*\.sh$' || true)
if [ -n "$code" ] && [ -z "$tests" ]; then
  _flag "tests changed with code" "code changed but no test file changed; explain in the pull request if none is needed"
else
  _pass "tests changed with code"
fi

echo "Result: $flags flag(s)."
[ "$flags" -eq 0 ]
