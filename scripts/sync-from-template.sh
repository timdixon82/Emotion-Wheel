#!/usr/bin/env bash
# sync-from-template.sh: refresh this project's .claude/ configuration from
# the agent-team master template.
#
# What it syncs (in three passes):
#
#   Pass 1 — wholesale overwrite (no merging):
#     .claude/hooks/        — all hooks, including the safety gate
#     .claude/settings.json — permissions and hook registrations
#     .claude/commands/     — slash-command definitions
#     .claude/output-styles/ — output style definitions
#
#   Pass 1b — scripts/ sync (verbatim overwrite):
#     scripts/next-q.sh           — question-numbering tool
#     scripts/sync-from-template.sh — this script (self-updating in project)
#
#   Pass 1c — root and github template sync (verbatim overwrite):
#     .editorconfig               — editor configuration (team standard)
#     .gitignore                  — NOT replaced. Required lines (today
#                                   .claude/transcripts/) are appended if
#                                   missing; nothing is removed or changed.
#     .github/workflows/         — CI/CD workflow definitions
#     .github/scripts/           - scripts the workflows call (today
#                                  deploy-publish.sh, used by deploy.yml)
#     .github/deploy-publish.txt - the project's Pages publish list. It is
#                                  PROJECT-OWNED: created only when absent
#                                  (a generated default that keeps just the
#                                  canonical folders the project has), and
#                                  never overwritten or reported as drift.
#                                  Not created for the browser-extension and
#                                  wordpress-theme archetypes, nor for a
#                                  project that lists deploy.yml in
#                                  .claude/workflows-protect (it migrates by
#                                  hand; see docs/patterns/github-pages-deploy.md).
#     ci-tools/lint-tools/ and ci-tools/accessibility-tools/ —
#                                 package.json and package-lock.json only.
#                                 Dot-files and any other file in the tool
#                                 folders are project-owned and never touched.
#
#   The tool folders moved from .github/<tool> to ci-tools/<tool> because
#   Dependabot refuses npm update pull requests for a root .github folder.
#   Sync never moves a folder. For each tool, it reads one of four states:
#     NEW     ci-tools/<tool> exists: package files are synced there.
#     OLD     .github/<tool> exists: nothing is copied for the tool, and
#             "NOT MIGRATED" is printed. Run scripts/migrate-ci-tools.sh from
#             the team repository to move the project.
#     BOTH    both exist: a defect. Sync stops with a non-zero exit before
#             it changes anything.
#     ABSENT  neither exists: lint-tools is never created (a project that
#             does not use it is left alone); accessibility-tools is created
#             in ci-tools/, as it always was, because accessibility.yml
#             needs it.
#   Workflow gate: lint.yml is copied only when lint-tools is NEW or ABSENT,
#   and accessibility.yml only when accessibility-tools is NEW or ABSENT.
#   Otherwise the workflow is skipped, so a project never receives a workflow
#   that points at ci-tools paths that do not exist there.
#
#   Pass 1.5 — agent frontmatter sync:
#     .claude/agents/*.md   — the YAML frontmatter (between --- delimiters)
#                             and any heading text before <!-- BEGIN CORE -->
#                             are replaced from the master. skills:, tools:,
#                             color:, model:, and permissionMode: all flow
#                             through. PROJECT OVERLAY is never touched.
#
#   Pass 2 — CORE-section update (preserves PROJECT OVERLAY):
#     .claude/agents/*.md   — only the <!-- BEGIN CORE --> … <!-- END CORE -->
#                             block is replaced; the PROJECT OVERLAY section
#                             below it is never touched.
#
# What it never touches:
#   Agent PROJECT OVERLAY sections
#   docs/  (the project wiki)
#   The project section of CLAUDE.md (Pass 3 replaces only the team section
#   and the generated project map; see scripts/claude-md-sync.sh)
#   VERSION
#   Existing .gitignore lines (only missing required lines are appended)
#
# After syncing it:
#   - Updates .claude/template-version with the master VERSION
#   - Stamps .claude/template-hook-sha256 with the sha256 of pre-tool-use.sh
#   - Runs the parity self-test (exits 1 on any failure)
#
# Usage:
#   bash scripts/sync-from-template.sh <path-to-master-template>

set -euo pipefail

# ── Locate helpers ────────────────────────────────────────────────────────────
# This script is deployed both to project repos (scripts/) and kept at the
# team root. The lib/parity.sh helper is available at the team root; project
# copies are standalone. Inline all helpers so the script is self-contained.

# ── Inline helpers (mirrors scripts/lib/parity.sh; kept in sync by sync-all) ─

validate_path() {
  local p="$1"
  case "$p" in /*) ;; *) return 1 ;; esac
  case "$p" in
    *[[:space:]]* | *'"'* | *'$'* | *'`'* | *';'*) return 1 ;;
  esac
  return 0
}

is_team_root() {
  local dir="$1"
  [ -f "$dir/CLAUDE.md" ] || return 1
  grep -qE '^# Claude Agent Team' "$dir/CLAUDE.md"
}

# Which of the two npm tool folders a project has, and where. Prints NEW, OLD,
# BOTH or ABSENT. Mirrors ci_tool_state in scripts/lib/ci-tools.sh; keep the
# two identical. This script is copied into projects, so it cannot source lib/.
ci_tool_state() {
  local tool="$1" root="$2" has_new=0 has_old=0
  [ -d "$root/ci-tools/$tool" ] && has_new=1
  [ -d "$root/.github/$tool" ] && has_old=1
  if [ "$has_new" -eq 1 ] && [ "$has_old" -eq 1 ]; then
    echo BOTH
  elif [ "$has_new" -eq 1 ]; then
    echo NEW
  elif [ "$has_old" -eq 1 ]; then
    echo OLD
  else
    echo ABSENT
  fi
}

sha256_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | cut -d' ' -f1
  else
    shasum -a 256 "$file" | cut -d' ' -f1
  fi
}

# Read the project type from .claude/project-type.
# If absent, ask interactively (requires /dev/tty).
# Writes the type to the file if it was absent and a value was given.
# Prints the type to stdout; prints nothing on failure.
read_or_ask_project_type() {
  local project_root="$1"
  local type_file="$project_root/.claude/project-type"

  if [ -f "$type_file" ]; then
    tr -d '[:space:]' < "$type_file"
    return 0
  fi

  # Absent — ask if a terminal is available.
  if [ ! -e /dev/tty ]; then
    echo "unknown"
    return 0
  fi

  printf '[INFO] .claude/project-type is not set for this project.\n' > /dev/tty
  printf '[INFO] Valid types: code (c), documentation (d)\n' > /dev/tty
  printf 'Project type: ' > /dev/tty
  local proj_type=""
  read -r proj_type < /dev/tty 2>/dev/null || proj_type=""

  case "$proj_type" in
    code|c)
      printf 'code\n' > "$type_file"
      printf 'code'
      ;;
    documentation|d)
      printf 'documentation\n' > "$type_file"
      printf 'documentation'
      ;;
    *)
      printf '[WARN] Unrecognised type "%s". Leaving unset; workflows will be skipped.\n' "$proj_type" > /dev/tty
      echo "unknown"
      ;;
  esac
}

# Returns true if the given project type should receive workflow files.
type_gets_workflows() {
  case "$1" in
    code|web-static|web-php|wordpress) return 0 ;;
    *) return 1 ;;
  esac
}

run_parity_test() {
  local proj="$1"
  local master="$2"
  local fail=0
  local label
  label="$(basename "$proj")"

  local hook="$proj/.claude/hooks/pre-tool-use.sh"
  local master_hook="$master/.claude/hooks/pre-tool-use.sh"
  local settings="$proj/.claude/settings.json"
  local master_settings="$master/.claude/settings.json"

  if [ ! -f "$hook" ]; then
    echo "  FAIL [$label] pre-tool-use.sh missing"
    fail=1
  elif [ ! -x "$hook" ]; then
    echo "  FAIL [$label] pre-tool-use.sh not executable"
    fail=1
  fi

  if [ -f "$hook" ] && [ -f "$master_hook" ]; then
    if ! cmp -s "$hook" "$master_hook"; then
      echo "  FAIL [$label] pre-tool-use.sh differs from master (byte-for-byte)"
      fail=1
    fi
  fi

  if [ ! -f "$settings" ]; then
    echo "  FAIL [$label] settings.json missing"
    fail=1
  fi

  if [ -f "$settings" ] && [ -f "$master_settings" ]; then
    if ! cmp -s "$settings" "$master_settings"; then
      echo "  FAIL [$label] settings.json differs from master (byte-for-byte)"
      fail=1
    fi
  fi

  if [ -f "$settings" ]; then
    if ! grep -q '"PreToolUse"' "$settings"; then
      echo "  FAIL [$label] settings.json: no PreToolUse hook block"
      fail=1
    elif ! grep -q 'pre-tool-use\.sh' "$settings"; then
      echo "  FAIL [$label] settings.json: PreToolUse not pointing at pre-tool-use.sh"
      fail=1
    fi
    local banned
    banned="$(grep -E '"Bash\(git \*\)"|"Bash\(gh \*\)"|"Bash\(cd \*\)"|"Write\(/|"Edit\(/' \
               "$settings" 2>/dev/null || true)"
    if [ -n "$banned" ]; then
      echo "  FAIL [$label] settings.json allow-list contains banned entry: $banned"
      fail=1
    fi
  fi

  if [ -f "$hook" ] && [ -x "$hook" ]; then
    local deny_json
    deny_json='{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}'
    local hook_out
    hook_out="$(printf '%s' "$deny_json" \
      | CLAUDE_PROJECT_DIR="$proj" bash "$hook" 2>/dev/null || true)"
    if ! printf '%s' "$hook_out" | grep -q '"permissionDecision":"deny"'; then
      echo "  FAIL [$label] copied hook did not deny synthetic 'git push --force'"
      fail=1
    fi
  fi

  if [ "$fail" -eq 0 ]; then
    echo "  PASS [$label] all 7 gate-integrity checks passed"
    return 0
  else
    return 1
  fi
}

# ── Main ───────────────────────────────────────────────────────────────────────
#
# Everything from here to the last line runs inside main(). Bash reads a
# function body completely before it runs, and the final line exits, so this
# script can safely overwrite its own file on disk (Pass 1b copies the new
# version of this script over the old one) without bash re-reading a changed
# file at a stale position. The body is deliberately not re-indented, to keep
# the diff small.
main() {

# ── Arguments ──────────────────────────────────────────────────────────────────
#
# $1 (required) — path to the master template repository
# $2 (optional) — explicit project root; if omitted, inferred from script location.
#   Pass $2 when calling this script from an external wrapper (e.g. sync-all-projects.sh)
#   that lives outside the project directory tree.

template="${1:?Usage: bash scripts/sync-from-template.sh <path-to-master-template> [<project-root>]}"

if [ -n "${2:-}" ]; then
  project_root="$(realpath "$2")"
else
  project_root="$(realpath "$(dirname "$0")/..")"
fi

# Validate and verify the supplied master path
if ! validate_path "$template"; then
  echo "ERROR: master path contains invalid characters or is not absolute." >&2
  exit 1
fi

if [ ! -d "$template" ]; then
  echo "ERROR: master path does not exist: $template" >&2
  exit 1
fi

if ! is_team_root "$template"; then
  echo "ERROR: $template does not look like the agent-team master (CLAUDE.md H1 check failed)." >&2
  exit 1
fi

[ -d "$template/.claude/agents" ] || {
  echo "ERROR: no .claude/agents/ found in master: $template" >&2
  exit 1
}

# ── The sync manifests ────────────────────────────────────────────────────────
# Single source of truth for which paths are overwritten wholesale.
# Agents are NOT in SYNC_MANIFEST; they use CORE/OVERLAY handling in Pass 2.

SYNC_MANIFEST=(
  "hooks"
  "settings.json"
  "commands"
  "output-styles"
)

# Scripts that are synced verbatim from master's scripts/ to the project's
# scripts/ folder. These are standalone tools called directly by agents;
# syncing them ensures projects always run the latest version.
# sync-from-template.sh itself is included so the project's standalone copy
# stays current. Bash reads a script file as it runs, so overwriting the file
# on disk can crash a running instance; that is why the whole body runs inside
# main(), which bash reads in full before any line of it executes.

SCRIPTS_MANIFEST=(
  "scripts/next-q.sh"
  "scripts/sync-from-template.sh"
  "scripts/record-backport.sh"
  "scripts/tasks.sh"
  "scripts/token-report.sh"
  "scripts/tier-suggest.sh"
  "scripts/review-precheck.sh"
  "scripts/wiki-log.sh"
  "scripts/handoff.sh"
)

# The npm tool folders (see the Pass 1c notes at the top of this file).
CI_TOOLS=("lint-tools" "accessibility-tools")

# While projects are being migrated from .github/<tool> to ci-tools/<tool>,
# a project still in the OLD state only gets a warning, so other content can
# still be synced into it. When the last project has migrated, change this to
# true in the same change that retires scripts/migrate-ci-tools.sh. Then a
# project in the OLD state makes sync exit non-zero, as BOTH always does.
OLD_STATE_IS_FAILURE=false

changed=0
old_state_count=0
echo "sync-from-template.sh: syncing $project_root from $template"
echo ""

# Pre-flight: refuse to sync a project that has a tool folder at both paths.
# This is a defect that sync must not paper over, so stop before any change.
for _tool in "${CI_TOOLS[@]}"; do
  if [ "$(ci_tool_state "$_tool" "$project_root")" = "BOTH" ]; then
    echo "ERROR: $_tool exists at both .github/$_tool and ci-tools/$_tool." >&2
    echo "       Remove one copy by hand, then run the sync again. Nothing was changed." >&2
    exit 1
  fi
done

# ── Pass 1: wholesale overwrite ───────────────────────────────────────────────

echo "Pass 1: wholesale sync of hooks/, settings.json, commands/"

for item in "${SYNC_MANIFEST[@]}"; do
  src="$template/.claude/$item"
  dst="$project_root/.claude/$item"

  if [ ! -e "$src" ]; then
    echo "  WARNING: $src not found in master; skipping"
    continue
  fi

  # Compare before overwriting so we can report accurately
  if [ -e "$dst" ]; then
    # For directories, diff recursively to detect changes
    if [ -d "$dst" ] && diff -rq "$src" "$dst" >/dev/null 2>&1; then
      echo "  unchanged: .claude/$item"
      continue
    elif [ -f "$dst" ] && cmp -s "$src" "$dst"; then
      echo "  unchanged: .claude/$item"
      continue
    fi
  fi

  rm -rf "$dst"
  cp -R "$src" "$dst"
  echo "  synced:    .claude/$item"
  changed=$((changed + 1))
done

# Ensure all hooks are executable after copy
if [ -d "$project_root/.claude/hooks" ]; then
  find "$project_root/.claude/hooks" -type f -name "*.sh" -exec chmod +x {} \;
fi

# ── Pass 1b: scripts/ sync ────────────────────────────────────────────────────

echo ""
echo "Pass 1b: scripts/ sync"

for item in "${SCRIPTS_MANIFEST[@]}"; do
  src="$template/$item"
  dst="$project_root/$item"

  if [ ! -f "$src" ]; then
    echo "  WARNING: $src not found in master; skipping"
    continue
  fi

  # Create the destination directory if it does not yet exist.
  dst_dir="$(dirname "$dst")"
  mkdir -p "$dst_dir"

  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    echo "  unchanged: $item"
    continue
  fi

  cp "$src" "$dst"
  chmod +x "$dst"
  echo "  synced:    $item"
  changed=$((changed + 1))
done

# ── Pass 1c: root and github template sync ────────────────────────────────────

ROOT_MANIFEST=(
  ".editorconfig"
)

GITHUB_TEMPLATES_MANIFEST=(
  "workflows"
  "scripts"
)

# Determine project type and whether workflows apply.
_project_type="$(read_or_ask_project_type "$project_root")"
echo ""
echo "Pass 1c: root and github template sync (project type: $_project_type)"

for item in "${ROOT_MANIFEST[@]}"; do
  src="$template/$item"
  dst="$project_root/$item"

  if [ ! -e "$src" ]; then
    echo "  WARNING: $src not found in master; skipping"
    continue
  fi

  if [ -e "$dst" ] && cmp -s "$src" "$dst"; then
    echo "  unchanged: $item"
    continue
  fi

  cp "$src" "$dst"
  echo "  synced:    $item"
  changed=$((changed + 1))
done

# .gitignore is project-owned, so it is never replaced. Each line listed here
# is appended only if the project's .gitignore does not already hold it
# (an exact whole-line match). Nothing is removed or reordered, and a missing
# .gitignore is created with just these lines.
GITIGNORE_REQUIRED=(
  ".claude/transcripts/"
)

_gi="$project_root/.gitignore"
for _line in "${GITIGNORE_REQUIRED[@]}"; do
  # A trailing carriage return (Windows line endings) is ignored when matching.
  # grep -c reads all input, so there is no early-exit pipe failure under pipefail.
  if [ -f "$_gi" ] && [ "$(tr -d '\r' < "$_gi" | grep -cxF "$_line" || true)" -gt 0 ]; then
    echo "  unchanged: .gitignore ($_line already listed)"
    continue
  fi
  # Start on a fresh line if the file does not end with a newline, then leave
  # one blank line before the new comment.
  if [ -s "$_gi" ]; then
    [ -z "$(tail -c 1 "$_gi")" ] || printf '\n' >> "$_gi"
    printf '\n' >> "$_gi"
  fi
  printf '# Local audit trail written by a team hook, not for the repository\n%s\n' "$_line" >> "$_gi"
  echo "  added:     .gitignore ($_line)"
  changed=$((changed + 1))
done

if type_gets_workflows "$_project_type"; then
  # Load the optional protect list from .claude/workflows-protect.
  # Format: one filename (basename) per line; lines starting with # are comments.
  # Any filename listed here is skipped during sync — the project's copy is kept.
  # The file is never itself synced, so project-specific entries are permanent.
  _protect_file="$project_root/.claude/workflows-protect"
  _protect_list=""
  if [ -f "$_protect_file" ]; then
    _protect_list="$(grep -v '^[[:space:]]*#' "$_protect_file" \
      | grep -v '^[[:space:]]*$' \
      | tr -d '\r' \
      || true)"
  fi

  for item in "${GITHUB_TEMPLATES_MANIFEST[@]}"; do
    src_dir="$template/templates/.github/$item"
    dst_dir="$project_root/.github/$item"

    if [ ! -e "$src_dir" ]; then
      echo "  WARNING: $src_dir not found in master templates; skipping"
      continue
    fi

    mkdir -p "$dst_dir"

    # File-by-file sync: template files are added/updated in the project.
    # Files in the project that are not in the template are preserved.
    # Files listed in .claude/workflows-protect are never overwritten.
    for src_file in "$src_dir"/*; do
      [ -f "$src_file" ] || continue
      fname="$(basename "$src_file")"
      dst_file="$dst_dir/$fname"

      # Check protect list (skip if filename matches any entry).
      if [ -n "$_protect_list" ] && printf '%s\n' "$_protect_list" | grep -qxF "$fname" 2>/dev/null; then
        echo "  protected: .github/$item/$fname"
        continue
      fi

      # Workflow gate: lint.yml and accessibility.yml name the ci-tools
      # paths. Copy each only when its tool folder is NEW or ABSENT, never
      # while the folder is still at the old .github path.
      _gate_tool=""
      if [ "$item" = "workflows" ]; then
        case "$fname" in
          lint.yml)          _gate_tool="lint-tools" ;;
          accessibility.yml) _gate_tool="accessibility-tools" ;;
        esac
      fi
      if [ -n "$_gate_tool" ]; then
        case "$(ci_tool_state "$_gate_tool" "$project_root")" in
          OLD|BOTH)
            echo "  SKIPPED:   .github/$item/$fname would reference ci-tools paths that do not exist here"
            continue
            ;;
        esac
      fi

      if [ -f "$dst_file" ] && cmp -s "$src_file" "$dst_file"; then
        echo "  unchanged: .github/$item/$fname"
        continue
      fi

      cp "$src_file" "$dst_file"
      echo "  synced:    .github/$item/$fname"
      changed=$((changed + 1))
    done
  done

  # Pages publish list: project-owned. Created only when absent, never
  # overwritten, so it is deliberately NOT in GITHUB_TEMPLATES_MANIFEST (that
  # loop overwrites). The generated default keeps only the canonical folders
  # the project has; the deploy workflow fails closed if the list is wrong.
  _pub_src="$template/templates/.github/deploy-publish.txt"
  _pub_script="$template/templates/.github/scripts/deploy-publish.sh"
  _pub_dst="$project_root/.github/deploy-publish.txt"
  _pub_archetype=""
  if [ -f "$project_root/.github/ci-archetype" ]; then
    _pub_archetype="$(tr -d '[:space:]' < "$project_root/.github/ci-archetype")"
  fi
  if [ -e "$_pub_dst" ]; then
    echo "  kept:      .github/deploy-publish.txt (project publish list)"
  elif [ "$_pub_archetype" = "browser-extension" ] || [ "$_pub_archetype" = "wordpress-theme" ]; then
    echo "  skipped:   .github/deploy-publish.txt (archetype '$_pub_archetype' has no Pages site)"
  elif [ -n "$_protect_list" ] && printf '%s\n' "$_protect_list" | grep -qxF "deploy.yml" 2>/dev/null; then
    echo "  skipped:   .github/deploy-publish.txt (deploy.yml is protected; migrate by hand, see docs/patterns/github-pages-deploy.md)"
  elif [ ! -f "$_pub_src" ] || [ ! -f "$_pub_script" ]; then
    echo "  WARNING: publish list template or script not found in master templates; skipping"
  else
    if DEPLOY_PUBLISH_ROOT="$project_root" bash "$_pub_script" default "$_pub_src" > "$_pub_dst.tmp"; then
      mv "$_pub_dst.tmp" "$_pub_dst"
      echo "  created:   .github/deploy-publish.txt (generated default, review before merging)"
      changed=$((changed + 1))
    else
      rm -f "$_pub_dst.tmp"
      echo "  WARNING: could not generate .github/deploy-publish.txt; create it by hand"
    fi
  fi

  # npm tool folders: copy only the two dependency files, into ci-tools/<tool>,
  # according to each tool's state. Sync never moves a folder. Honours the same
  # protect list as the workflows.
  for _tool in "${CI_TOOLS[@]}"; do
    tool_src="$template/templates/ci-tools/$_tool"
    tool_dst="$project_root/ci-tools/$_tool"
    _state="$(ci_tool_state "$_tool" "$project_root")"

    case "$_state" in
      OLD)
        echo "  NOT MIGRATED: $_tool is at .github/$_tool; run scripts/migrate-ci-tools.sh from the team repository"
        old_state_count=$((old_state_count + 1))
        continue
        ;;
      ABSENT)
        if [ "$_tool" = "accessibility-tools" ]; then
          # accessibility.yml needs this folder, so it is created, as it
          # always has been. Lint-tools is never created.
          mkdir -p "$tool_dst"
        else
          echo "  skipped:   ci-tools/$_tool/ (project has no $_tool folder)"
          continue
        fi
        ;;
    esac

    for fname in package.json package-lock.json; do
      src_file="$tool_src/$fname"
      dst_file="$tool_dst/$fname"

      if [ ! -f "$src_file" ]; then
        echo "  WARNING: $src_file not found in master templates; skipping"
        continue
      fi

      if [ -n "$_protect_list" ] && printf '%s\n' "$_protect_list" | grep -qxF "$fname" 2>/dev/null; then
        echo "  protected: ci-tools/$_tool/$fname"
        continue
      fi

      if [ -f "$dst_file" ] && cmp -s "$src_file" "$dst_file"; then
        echo "  unchanged: ci-tools/$_tool/$fname"
        continue
      fi

      cp "$src_file" "$dst_file"
      echo "  synced:    ci-tools/$_tool/$fname"
      changed=$((changed + 1))
    done
  done
else
  echo "  skipped:   .github/workflows/ (project type '$_project_type' does not use build workflows)"
  echo "  skipped:   ci-tools/ (same reason)"
fi

# ── Pass 1.5: agent frontmatter sync ─────────────────────────────────────────
#
# Updates the YAML frontmatter (between the --- delimiters) and any heading text
# between the frontmatter and <!-- BEGIN CORE --> in each agent file.
# The CORE block and PROJECT OVERLAY section are not touched here; they are
# handled by Pass 2 and preserved respectively.
#
# This pass fixes the gap where skills:, tools:, color:, model:, and other
# frontmatter fields added to the master template did not flow through to
# project repos on sync.

echo ""
echo "Pass 1.5: agent frontmatter sync"

_update_frontmatter() {
  local tfile="$1"
  local pfile="$2"
  local display="$3"

  # New agent files are handled wholesale by Pass 2's _update_core; skip here.
  if [ ! -f "$pfile" ]; then
    return
  fi

  # Extract everything before <!-- BEGIN CORE --> from the template.
  local tmpl_pre
  tmpl_pre="$(mktemp)"
  awk '/<!-- BEGIN CORE -->/{exit} {print}' "$tfile" > "$tmpl_pre"

  if [ ! -s "$tmpl_pre" ]; then
    rm -f "$tmpl_pre"
    echo "  WARNING: no pre-CORE content found in template $display; skipping"
    return
  fi

  # Extract the same section from the project file for comparison.
  local proj_pre
  proj_pre="$(mktemp)"
  awk '/<!-- BEGIN CORE -->/{exit} {print}' "$pfile" > "$proj_pre"

  if cmp -s "$tmpl_pre" "$proj_pre"; then
    rm -f "$tmpl_pre" "$proj_pre"
    echo "  unchanged: $display"
    return
  fi

  rm -f "$proj_pre"

  # Build the replacement: template preamble + project content from <!-- BEGIN CORE --> onward.
  local tmp
  tmp="$(mktemp)"
  cat "$tmpl_pre" > "$tmp"
  awk 'found || /<!-- BEGIN CORE -->/{found=1; print}' "$pfile" >> "$tmp"
  rm -f "$tmpl_pre"

  if cmp -s "$pfile" "$tmp"; then
    rm -f "$tmp"
    echo "  unchanged: $display"
  else
    mv "$tmp" "$pfile"
    echo "  updated:   $display (frontmatter synced from master)"
    changed=$((changed + 1))
  fi
}

for tfile in "$template"/.claude/agents/*.md; do
  [ -f "$tfile" ] || continue
  name="$(basename "$tfile")"
  pfile="$project_root/.claude/agents/$name"
  _update_frontmatter "$tfile" "$pfile" ".claude/agents/$name"
done

# Subdirectory agent files (kept for extensibility; currently none exist).
for tfile in "$template"/.claude/agents/*/*.md; do
  [ -f "$tfile" ] || continue
  subdir="$(basename "$(dirname "$tfile")")"
  name="$(basename "$tfile")"
  pfile="$project_root/.claude/agents/$subdir/$name"
  _update_frontmatter "$tfile" "$pfile" ".claude/agents/$subdir/$name"
done

# ── Pass 2: agent CORE sections ───────────────────────────────────────────────
#
# Walks .claude/agents/*.md (all agents — core and specialist) and any subdirectory
# agent files that carry a <!-- BEGIN CORE --> block. All accessibility specialist
# agents (aria-specialist, contrast-master, forms-specialist, keyboard-navigator,
# screen-reader-lab, wcag-aaa) now live at the top level of .claude/agents/ so
# Claude Code discovers them automatically. The subdirectory loop below is kept
# for extensibility but currently finds no files.
# Files without a CORE block are skipped with a warning, so non-CORE specialist
# files (plain markdown, manifests, LICENCE) are never accidentally modified.

echo ""
echo "Pass 2: agent CORE sections"

# Helper: update CORE block in one agent file.
# Arguments: $1 = template file path, $2 = project file path, $3 = display name
_update_core() {
  local tfile="$1"
  local pfile="$2"
  local display="$3"

  if [ ! -f "$pfile" ]; then
    mkdir -p "$(dirname "$pfile")"
    cp "$tfile" "$pfile"
    echo "  added:     $display (new agent copied from template)"
    changed=$((changed + 1))
    return
  fi

  local core_file
  core_file="$(mktemp)"
  awk '/<!-- BEGIN CORE -->/{f=1} f{print} /<!-- END CORE -->/{f=0}' "$tfile" > "$core_file"
  if [ ! -s "$core_file" ]; then
    rm -f "$core_file"
    echo "  WARNING: no CORE block in $display; skipping"
    return
  fi

  # Write the CORE block to a temp file and read it back with getline.
  # Passing a multi-line string via awk -v fails on macOS awk (BSD awk).
  local tmp
  tmp="$(mktemp)"
  awk -v cfile="$core_file" '
    /<!-- BEGIN CORE -->/ {
      while ((getline line < cfile) > 0) print line
      skip=1; next
    }
    skip && /<!-- END CORE -->/ {skip=0; next}
    !skip {print}
  ' "$pfile" > "$tmp"
  rm -f "$core_file"

  if cmp -s "$pfile" "$tmp"; then
    rm -f "$tmp"
    echo "  unchanged: $display"
  else
    mv "$tmp" "$pfile"
    echo "  updated:   $display (CORE replaced, OVERLAY preserved)"
    changed=$((changed + 1))
  fi
}

# Core agents at the top level of .claude/agents/
for tfile in "$template"/.claude/agents/*.md; do
  [ -f "$tfile" ] || continue
  name="$(basename "$tfile")"
  pfile="$project_root/.claude/agents/$name"
  _update_core "$tfile" "$pfile" ".claude/agents/$name"
done

# Specialist agents in subdirectories of .claude/agents/ (kept for extensibility;
# no subdirectory agents exist since accessibility agents were flattened in v1.5.7).
# Only .md files that contain a CORE block are processed; the helper skips
# those without one, so plain manifests, LICENCE files, and README files
# in subdirectories are never touched.
for tfile in "$template"/.claude/agents/*/*.md; do
  [ -f "$tfile" ] || continue
  subdir="$(basename "$(dirname "$tfile")")"
  name="$(basename "$tfile")"
  pfile="$project_root/.claude/agents/$subdir/$name"
  _update_core "$tfile" "$pfile" ".claude/agents/$subdir/$name"
done

# ── Pass 3: CLAUDE.md (Decision 024) ──────────────────────────────────────────
# The team section is replaced from the master, the project section is kept,
# and the generated project map is refreshed. A legacy file is migrated once.
# Always the master's copy of the helper, so the logic matches the master.

echo ""
echo "Pass 3: CLAUDE.md team section and project map"
cm_script="$template/scripts/claude-md-sync.sh"
if [ -f "$cm_script" ]; then
  cm_out="$(bash "$cm_script" "$template" "$project_root")" || {
    echo "ERROR: claude-md-sync.sh failed for $project_root." >&2
    exit 1
  }
  printf '%s\n' "$cm_out" | sed 's/^/  /'
  case "$cm_out" in
    *"CLAUDE.md: unchanged"*|*"CLAUDE.md: skipped"*) ;;
    *) changed=$((changed + 1)) ;;
  esac
else
  echo "  skipped: master has no scripts/claude-md-sync.sh"
fi

# ── Update stamps ─────────────────────────────────────────────────────────────
# Write stamps only when their content actually changes, so a no-op sync does
# not leave the repo with uncommitted tracked changes (which would block the
# next sync run).

master_version="$(cat "$template/VERSION" 2>/dev/null || echo unknown)"

prev_version="$(cat "$project_root/.claude/template-version" 2>/dev/null || echo unknown)"
if [ "$prev_version" != "$master_version" ]; then
  printf '%s\n' "$master_version" > "$project_root/.claude/template-version"
  echo ""
  echo "  template-version: $prev_version → $master_version"
  changed=$((changed + 1))
fi

# Stamp sha256 of the newly-synced pre-tool-use.sh — only if changed.
hook_path="$project_root/.claude/hooks/pre-tool-use.sh"
if [ -f "$hook_path" ]; then
  hook_sha="$(sha256_of "$hook_path")"
  sha_file="$project_root/.claude/template-hook-sha256"
  prev_sha="$(cat "$sha_file" 2>/dev/null | tr -d '[:space:]' || echo '')"
  if [ "$prev_sha" != "$hook_sha" ]; then
    printf '%s\n' "$hook_sha" > "$sha_file"
    echo "  template-hook-sha256: $hook_sha"
    changed=$((changed + 1))
  fi
fi

# ── Parity self-test ──────────────────────────────────────────────────────────

echo ""
echo "Running parity self-test..."
echo ""

if run_parity_test "$project_root" "$template"; then
  echo ""
  echo "Sync complete. $changed item(s) changed."
  echo "  PROJECT OVERLAY sections in agent files were not touched."
  echo "  The project section of CLAUDE.md was not touched, apart from its generated map."
  echo "  docs/ wiki was not touched."
  echo ""
  echo "Review the changes, then open a pull request."
  echo "Opening a pull request is a gated action — pause for Tim's approval."
  if [ "$old_state_count" -gt 0 ]; then
    echo ""
    echo "NOT MIGRATED: $old_state_count tool folder(s) are still under .github/." >&2
    if [ "$OLD_STATE_IS_FAILURE" = true ]; then
      exit 1
    fi
  fi
else
  echo "" >&2
  echo "ERROR: parity self-test failed after sync." >&2
  echo "       Resolve the FAIL items above before opening a pull request." >&2
  exit 1
fi
}

main "$@"; exit $?
