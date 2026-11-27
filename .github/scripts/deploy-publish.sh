#!/usr/bin/env bash
# deploy-publish.sh: build and check the GitHub Pages site from a project's
# publish list, .github/deploy-publish.txt.
#
# The deploy workflow calls this script. It is identical in every project and
# is synced from the team template. The project's own file, the publish list,
# decides what becomes public; see docs/patterns/github-pages-deploy.md in the
# team repository for the format, and the comment header of the template list.
#
# Commands (run from the repository root, or set DEPLOY_PUBLISH_ROOT):
#
#   assemble [DIR]   Parse the list, check every path exists, copy the listed
#                    paths into DIR (default _site) with rsync, then check the
#                    result (listed paths present, required files present and
#                    not empty, index.html references resolve, nothing
#                    forbidden in the output). Fails closed.
#   verify DIR       For a build that already produced DIR (for example a Vite
#                    dist folder): the list, if present, is parsed and its
#                    require lines are enforced; the forbidden-file scan runs.
#   check            Parse the list and check every path exists in the
#                    checkout. Builds nothing.
#   live URL         After deploy: the site root and every require path must
#                    return 200 (three tries, ten seconds apart). A 200 on
#                    /CLAUDE.md or /docs/log.md is a warning only.
#   default TEMPLATE Print a starting list: the template list with the folders
#                    the project does not have removed. Used by the team sync
#                    and scaffold scripts.
#
# Symbolic links are never published: assemble does not copy them, and every
# check fails on a link in the output, on an output or dist folder that is a
# link, and on an include or require path that is or passes through a link.
# Include and require paths may not have a name that starts with a dot,
# because the upload step drops hidden files.
#
# Failures are GitHub error annotations that name the file and line. The
# script reads the list as data: nothing in it is ever evaluated by the shell,
# and the rsync rules are passed as separate arguments, never as a string.
#
# Written for bash 3.2 and later (macOS ships 3.2) and for GNU rsync, which
# the GitHub Ubuntu runner has.

set -euo pipefail
export LC_ALL=C

cd "${DEPLOY_PUBLISH_ROOT:-.}"

LIST=".github/deploy-publish.txt"
RETRY_DELAY="${DEPLOY_PUBLISH_RETRY_DELAY:-10}"
TRIES=3

# First path segments that may never be named in an include line.
FORBIDDEN_SEGMENTS=".git .github .claude node_modules docs ci-tools tests _site"

ERRORS=0
INCLUDES=()
INC_LINES=()
EXCLUDES=()
REQUIRES=()
REQ_LINES=()

# ── Messages ─────────────────────────────────────────────────────────────────

# Escape text for a GitHub workflow command message.
esc() {
  local s="$1"
  s="${s//'%'/%25}"
  s="${s//$'\r'/%0D}"
  s="${s//$'\n'/%0A}"
  printf '%s' "$s"
}

# Show untrusted text safely: printable characters only, shortened.
show() {
  local s
  s="$(printf '%s' "$1" | tr -c '[:print:]' '?')"
  printf '%s' "${s:0:60}"
}

# err_line <line-number> <message>: an error tied to a line of the list.
err_line() {
  ERRORS=$((ERRORS + 1))
  printf '::error file=%s,line=%s::%s\n' "$LIST" "$1" "$(esc "deploy-publish.txt line $1: $2")"
}

# err_file <file> <message>: an error tied to a file but no line.
err_file() {
  ERRORS=$((ERRORS + 1))
  printf '::error file=%s::%s\n' "$1" "$(esc "$2")"
}

abort_if_errors() {
  [ "$ERRORS" -eq 0 ] || exit 1
}

# ── Parsing ──────────────────────────────────────────────────────────────────

# validate_path <path> <kind>: kind is include, require or exclude. Prints the
# reason and returns 1 if the path is not allowed.
validate_path() {
  local p="$1" kind="$2" charset='^[A-Za-z0-9._@/-]+$'
  [ "$kind" = exclude ] && charset='^[A-Za-z0-9._@/*?-]+$'
  case "$p" in
    /*) ;;
    *) echo "'$(show "$p")' must start with /, so it is anchored to the repository root"; return 1 ;;
  esac
  case "$p" in
    *..*) echo "'$(show "$p")' contains '..', which is not allowed"; return 1 ;;
    *//*) echo "'$(show "$p")' contains '//', which is not allowed"; return 1 ;;
    /) echo "a bare / is not allowed; it would publish the whole repository"; return 1 ;;
    */./*|*/.) echo "'$(show "$p")' contains a '.' folder, which is not allowed"; return 1 ;;
  esac
  if [ "$kind" != exclude ]; then
    case "$p" in
      *'*'*|*'?'*|*'['*) echo "'$(show "$p")': wildcards are only allowed on ! lines"; return 1 ;;
    esac
    # The upload step drops every file and folder whose name starts with a
    # dot, so a published path like that would pass every check here and then
    # never reach the live site. Refuse it up front. A ! line may name one.
    case "$p" in
      */.*) echo "'$(show "$p")' has a name that starts with a dot; the upload step drops hidden files and folders, so it would never be published"; return 1 ;;
    esac
  fi
  if ! [[ "$p" =~ $charset ]]; then
    echo "'$(show "$p")' contains characters other than letters, digits and . _ - / @ (spaces are not allowed)"
    return 1
  fi
  return 0
}

# parse <mode>: mode is rsync (an include list is required) or any.
parse() {
  local mode="$1" lineno=0 raw line rest msg seg s
  INCLUDES=(); INC_LINES=(); EXCLUDES=(); REQUIRES=(); REQ_LINES=()
  while IFS= read -r raw || [ -n "$raw" ]; do
    lineno=$((lineno + 1))
    line="${raw%$'\r'}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in
      ''|'#'*) continue ;;
      'require '*)
        rest="${line#require }"
        if ! msg="$(validate_path "$rest" require)"; then err_line "$lineno" "$msg"; continue; fi
        case "$rest" in
          */) err_line "$lineno" "require names a file, not a folder (remove the trailing /)"; continue ;;
        esac
        REQUIRES+=("$rest"); REQ_LINES+=("$lineno")
        ;;
      '!'*)
        rest="${line#!}"
        if ! msg="$(validate_path "$rest" exclude)"; then err_line "$lineno" "$msg"; continue; fi
        EXCLUDES+=("$rest")
        ;;
      /*)
        # The forbidden-folder check runs first, so /.github/ and /.git/ get
        # the clear "may not be published" message, not the hidden-path one.
        seg="${line#/}"; seg="${seg%%/*}"
        for s in $FORBIDDEN_SEGMENTS; do
          if [ "$seg" = "$s" ]; then
            err_line "$lineno" "/$seg/ may not be published; it is internal, build or test material"
            continue 2
          fi
        done
        if ! msg="$(validate_path "$line" include)"; then err_line "$lineno" "$msg"; continue; fi
        INCLUDES+=("$line"); INC_LINES+=("$lineno")
        ;;
      *)
        err_line "$lineno" "'$(show "$line")' must start with / (publish a path), ! (never publish) or the word require"
        ;;
    esac
  done < "$LIST"

  if [ "$mode" = rsync ] && [ "$ERRORS" -eq 0 ]; then
    if [ "${#INCLUDES[@]}" -eq 0 ]; then
      err_file "$LIST" "deploy-publish.txt needs at least one include line, for example /index.html"
    else
      local found=0 i
      for ((i = 0; i < ${#INCLUDES[@]}; i++)); do
        [ "${INCLUDES[$i]}" = /index.html ] && found=1
      done
      [ "$found" -eq 1 ] || err_file "$LIST" "deploy-publish.txt must include /index.html"
    fi
  fi
}

require_list_file() {
  if [ ! -f "$LIST" ] || [ -L "$LIST" ]; then
    err_file "$LIST" "Create .github/deploy-publish.txt; the team template sync does this, or copy the example from the team template."
    exit 1
  fi
}

# ── Checks ───────────────────────────────────────────────────────────────────

# within_one_edit <a> <b>: success if the names differ by one inserted,
# deleted or changed character, or one swap of neighbours.
within_one_edit() {
  local a="$1" b="$2" p=0 s l
  [ "$a" != "$b" ] || return 1
  while [ "$p" -lt "${#a}" ] && [ "$p" -lt "${#b}" ] && [ "${a:p:1}" = "${b:p:1}" ]; do p=$((p + 1)); done
  if [ "${#a}" -eq "${#b}" ]; then
    [ "${a:p+1}" = "${b:p+1}" ] && return 0
    [ "${a:p:1}" = "${b:p+1:1}" ] && [ "${a:p+1:1}" = "${b:p:1}" ] && [ "${a:p+2}" = "${b:p+2}" ] && return 0
    return 1
  fi
  if [ "${#a}" -lt "${#b}" ]; then s="$a"; l="$b"; else s="$b"; l="$a"; fi
  [ $((${#l} - ${#s})) -eq 1 ] && [ "${l:0:p}${l:p+1}" = "$s" ]
}

# suggest <top-level-name>: print a top-level entry one edit away, if any.
suggest() {
  local want="$1" p cand
  for p in ./* ./.[!.]*; do
    [ -e "$p" ] || continue
    cand="${p#./}"
    if within_one_edit "$want" "$cand"; then printf '/%s' "$cand"; return 0; fi
  done
  return 1
}

# link_in_path <base> <path>: success if <path> (which starts with /) is, or
# passes through, a symbolic link below <base>. Prints the part that is the
# link. The paths were validated by the parser, so they hold no wildcards.
link_in_path() {
  local base="$1" rest="${2#/}" cur="" seg
  rest="${rest%/}"
  while [ -n "$rest" ]; do
    seg="${rest%%/*}"
    if [ "$seg" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    cur="$cur/$seg"
    if [ -L "$base$cur" ]; then printf '%s' "$cur"; return 0; fi
  done
  return 1
}

# source_check: every include exists in the checkout, with the right shape,
# and is not a symbolic link or inside one.
source_check() {
  local i p rel top hint link
  for ((i = 0; i < ${#INCLUDES[@]}; i++)); do
    p="${INCLUDES[$i]}"
    rel=".$p"
    if link="$(link_in_path . "$p")"; then
      err_line "${INC_LINES[$i]}" "$p is, or passes through, a symbolic link ($link); symbolic links are never published"
      continue
    fi
    case "$p" in
      */)
        [ -d "$rel" ] && continue
        if [ -f "${rel%/}" ]; then
          err_line "${INC_LINES[$i]}" "$p is a file; remove the trailing /"
          continue
        fi
        ;;
      *)
        [ -f "$rel" ] && continue
        if [ -d "$rel" ]; then
          err_line "${INC_LINES[$i]}" "$p is a folder; write it as $p/ to publish the whole folder"
          continue
        fi
        ;;
    esac
    top="${p#/}"; top="${top%%/*}"
    hint=""
    if [ ! -e "./$top" ]; then
      hint="$(suggest "$top" || true)"
      [ -z "$hint" ] || hint=" (typo for ${hint}/?)"
    fi
    err_line "${INC_LINES[$i]}" "$p does not exist in the repository$hint"
  done
}

# has_file <folder>: success if the folder holds at least one file.
has_file() {
  [ -n "$(find "$1" -type f -print 2>/dev/null | head -n 1)" ]
}

# output_check <dir>: every include made it into the finished site.
output_check() {
  local out="$1" i p
  for ((i = 0; i < ${#INCLUDES[@]}; i++)); do
    p="${INCLUDES[$i]}"
    case "$p" in
      */)
        if [ ! -d "$out$p" ] || ! has_file "$out$p"; then
          err_line "${INC_LINES[$i]}" "$p published nothing; test files, node_modules and ! lines may have removed everything in it"
        fi
        ;;
      *)
        [ -f "$out$p" ] || err_line "${INC_LINES[$i]}" "$p is not in the finished site; a ! line or the built-in exclude rules removed it"
        ;;
    esac
  done
}

# require_check <dir>: every require file is in the site and not empty.
require_check() {
  local out="$1" i r link
  for ((i = 0; i < ${#REQUIRES[@]}; i++)); do
    r="${REQUIRES[$i]}"
    if link="$(link_in_path "$out" "$r")"; then
      err_line "${REQ_LINES[$i]}" "required file $r is, or passes through, a symbolic link ($link); symbolic links are never published"
    elif [ ! -f "$out$r" ]; then
      err_line "${REQ_LINES[$i]}" "required file $r is missing from the finished site; list it, or its folder, as an include"
    elif [ ! -s "$out$r" ]; then
      err_line "${REQ_LINES[$i]}" "required file $r is empty"
    fi
  done
}

# check_ref <out> <value> <kind>: one reference from index.html.
check_ref() {
  local out="$1" v="$2" kind="$3"
  v="${v%%[?#]*}"
  [ -n "$v" ] || return 0
  case "$v" in
    //*) return 0 ;;
  esac
  if [[ "$v" =~ ^[A-Za-z][A-Za-z0-9+.-]*: ]]; then return 0; fi
  [[ "$v" =~ ^[A-Za-z0-9._/@~-]+$ ]] || return 0
  if [ "$kind" = import ]; then
    case "$v" in
      ./*|../*|/*) ;;
      *) return 0 ;;
    esac
  fi
  case "$v" in
    *..*) err_file index.html "index.html refers to $v, which points outside the site"; return 0 ;;
    /*) [ -e "$out$v" ] && return 0 ;;
    *) [ -e "$out/$v" ] && return 0 ;;
  esac
  err_file index.html "index.html refers to $v, which is not in the finished site; add it to .github/deploy-publish.txt or fix the reference"
}

# reference_check <dir>: a coarse net for index.html. Relative src, href and
# module imports must exist in the finished site. It cannot see fetch() calls,
# which is what require lines are for.
reference_check() {
  local out="$1" idx="$1/index.html" m v
  [ -f "$idx" ] || return 0
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    v="${m#*[\"\']}"; v="${v%[\"\']}"
    check_ref "$out" "$v" attr
  done < <(grep -oiE "(^|[[:space:]])(src|href)[[:space:]]*=[[:space:]]*(\"[^\"]*\"|'[^']*')" "$idx" | sort -u || true)
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    v="${m#*[\"\']}"; v="${v%[\"\']}"
    check_ref "$out" "$v" import
  done < <(grep -oE "(from|import)[[:space:]]*(\"[^\"]*\"|'[^']*')" "$idx" | sort -u || true)
}

# deny_scan <dir>: nothing internal may be in the output, whichever path
# produced it. Fails closed: if find cannot read the whole folder, that is an
# error, not a pass. Any symbolic link is an error too, because the upload step
# packs the site with links followed, so a link would publish whatever it
# points at (for example CLAUDE.md) under an innocent name.
deny_scan() {
  local out="$1" hits hit
  if [ -L "$out" ]; then
    err_file "$out" "$out is a symbolic link; the site folder must be a real folder"
    return 0
  fi
  if ! hits="$(find "$out" \( -type l -o -iname CLAUDE.md -o -name .claude -o -name .git -o -name .github \
      -o -name node_modules -o -name ci-tools -o -name tests -o -name __tests__ -o \( -type d -name test \) -o \( -type d -name spec \) \
      -o -name package.json -o -name package-lock.json -o -name '.env*' \
      -o -iname '*.pem' -o -iname '*.key' -o -iname '*.p12' \
      -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name 'id_ecdsa*' -o -name 'id_dsa*' \
      -o -name '*.sh' -o -name '*.test.*' -o -name '*.spec.*' \) -print | sort)"; then
    err_file "$LIST" "The forbidden-file scan could not finish reading $out (a folder may be unreadable), so the site was not checked"
    return 0
  fi
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    if [ -L "$hit" ]; then
      err_file "$LIST" "Forbidden symbolic link in the site: /${hit#"$out"/} (links are followed when the site is packed, so they could publish files from outside the site)"
    else
      err_file "$LIST" "Forbidden file in the site: /${hit#"$out"/} (internal, secret, build or test material must never be published)"
    fi
  done <<< "$hits"
}

# warn_skipped_links: rsync --no-links drops symbolic links without failing the
# build, so name each one in a warning annotation. Only folder includes can hold
# links (a link as an include is already an error). Warning only: never fails.
warn_skipped_links() {
  local i p found shown count=0
  for ((i = 0; i < ${#INCLUDES[@]}; i++)); do
    p="${INCLUDES[$i]}"
    case "$p" in */) ;; *) continue ;; esac
    while IFS= read -r found; do
      [ -n "$found" ] || continue
      count=$((count + 1))
      [ "$count" -le 20 ] || continue
      shown="$(printf '%s' "${found#.}" | tr -c '[:print:]' '?')"
      printf '::warning::%s\n' "$(esc "A symbolic link was skipped and is not published: $shown (symbolic links are never copied to the site; if a page needs this file, replace the link with a real file)")"
    done < <(find ".$p" \( -name node_modules -o -name __tests__ \) -prune -o -type l -print 2>/dev/null | sort || true)
  done
  if [ "$count" -gt 20 ]; then
    printf '::warning::%s\n' "$(esc "$((count - 20)) more symbolic links were skipped and are not listed here")"
  fi
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_check() {
  require_list_file
  parse rsync
  abort_if_errors
  source_check
  abort_if_errors
  echo "deploy-publish: list is valid and every path exists (${#INCLUDES[@]} includes, ${#REQUIRES[@]} required files)"
}

cmd_assemble() {
  local out="${1:-_site}" i
  out="${out%/}"
  require_list_file
  parse rsync
  abort_if_errors
  source_check
  abort_if_errors

  command -v rsync >/dev/null 2>&1 || { err_file "$LIST" "rsync is not installed on this runner"; exit 1; }
  if [ -L "$out" ]; then
    err_file "$out" "$out is a symbolic link; refusing to write the site through it"
    exit 1
  fi
  mkdir -p "$out"
  if [ -n "$(find "$out" -mindepth 1 -print -quit)" ]; then
    err_file "$out" "$out already exists and is not empty; refusing to mix files into it"
    exit 1
  fi

  # First match wins: built-in excludes, then the project's ! lines, then its
  # includes, then descend-only, then exclude everything else.
  #
  # --no-links: symbolic links are never copied. The upload step packs the site
  # with links followed, so a link that survived would publish its target. The
  # other choice, --copy-unsafe-links, would copy the target of a link that
  # points outside the tree, which is the leak we are closing. A link in a
  # published folder is skipped, named in a warning annotation (and in the
  # rsync log). The deny scan below still fails on any link in the output, as a
  # second net.
  warn_skipped_links
  local args=(-a --no-links --prune-empty-dirs
    --filter='- *.test.*' --filter='- *.spec.*' --filter='- __tests__/' --filter='- node_modules/')
  for ((i = 0; i < ${#EXCLUDES[@]}; i++)); do
    args+=(--filter="- ${EXCLUDES[$i]}")
  done
  for ((i = 0; i < ${#INCLUDES[@]}; i++)); do
    case "${INCLUDES[$i]}" in
      */) args+=(--filter="+ ${INCLUDES[$i]}***") ;;
      *)  args+=(--filter="+ ${INCLUDES[$i]}") ;;
    esac
  done
  args+=(--filter='+ */' --filter='- *')
  rsync "${args[@]}" ./ "$out/"

  output_check "$out"
  require_check "$out"
  reference_check "$out"
  deny_scan "$out"
  abort_if_errors
  echo "deploy-publish: $out assembled and checked (${#INCLUDES[@]} includes, ${#REQUIRES[@]} required files)"
}

cmd_verify() {
  local out="${1:?usage: deploy-publish.sh verify DIR}"
  out="${out%/}"
  if [ -L "$out" ]; then
    err_file "$out" "$out is a symbolic link; the site folder must be a real folder"
    exit 1
  fi
  [ -d "$out" ] || { err_file "$out" "$out is not a folder"; exit 1; }
  if [ -f "$LIST" ] && [ ! -L "$LIST" ]; then
    parse any
    abort_if_errors
    require_check "$out"
  fi
  deny_scan "$out"
  abort_if_errors
  echo "deploy-publish: $out checked (${#REQUIRES[@]} required files)"
}

# http_status <url>: the final status code, or 000 if unreachable. A site
# served over https may only redirect to https, so a redirect cannot quietly
# move the check to a plain-http address.
http_status() {
  local code redir='=http,https'
  case "$1" in
    https://*) redir='=https' ;;
  esac
  code="$(curl -s -o /dev/null -w '%{http_code}' -L --max-redirs 5 --max-time 20 \
    --proto '=http,https' --proto-redir "$redir" "$1" 2>/dev/null || true)"
  printf '%s' "${code:-000}"
}

# wait_for_200 <url>: success if the URL returns 200 within TRIES tries.
wait_for_200() {
  local url="$1" attempt code=000
  for ((attempt = 1; attempt <= TRIES; attempt++)); do
    code="$(http_status "$url")"
    [ "$code" = 200 ] && return 0
    [ "$attempt" -lt "$TRIES" ] && sleep "$RETRY_DELAY"
  done
  LAST_CODE="$code"
  return 1
}

cmd_live() {
  local base="${1:?usage: deploy-publish.sh live URL}" i r probe LAST_CODE=000
  base="${base%/}"
  case "$base" in
    http://*|https://*) ;;
    *) err_file "$LIST" "live check needs an http or https address"; exit 1 ;;
  esac
  if [ -f "$LIST" ] && [ ! -L "$LIST" ]; then
    parse any
    abort_if_errors
  fi
  if ! wait_for_200 "$base/"; then
    err_file "$LIST" "Live check: the site root ($base/) returned $LAST_CODE after $TRIES tries"
  fi
  for ((i = 0; i < ${#REQUIRES[@]}; i++)); do
    r="${REQUIRES[$i]}"
    if ! wait_for_200 "$base$r"; then
      err_line "${REQ_LINES[$i]}" "Live check: required file $r returned $LAST_CODE after $TRIES tries"
    fi
  done
  # Legacy sites (Pages still on "Deploy from a branch") serve the whole
  # repository, so a 200 here is expected until the switch. Warning only.
  for probe in /CLAUDE.md /docs/log.md; do
    if [ "$(http_status "$base$probe")" = 200 ]; then
      printf '::warning::%s\n' "$(esc "Live check: $base$probe returns 200. Expected only while GitHub Pages is still set to Deploy from a branch; after the switch to GitHub Actions it must return 404.")"
    fi
  done
  abort_if_errors
  echo "deploy-publish: live site checked (root and ${#REQUIRES[@]} required files return 200)"
}

# has_publishable_file <folder>: success if the folder holds a file that the
# deploy could publish. Shell scripts and test files never count, so a
# scripts/ folder that holds only team tooling is not listed by default.
has_publishable_file() {
  [ -d "$1" ] || return 1
  [ -n "$(find "$1" \( -name node_modules -o -name __tests__ \) -prune -o -type f \
    ! -name '*.sh' ! -name '*.test.*' ! -name '*.spec.*' -print 2>/dev/null | head -n 1)" ]
}

cmd_default() {
  local tpl="${1:?usage: deploy-publish.sh default TEMPLATE}" raw line
  [ -f "$tpl" ] || { echo "template list not found: $tpl" >&2; exit 1; }
  printf '%s\n' "# Generated default, review before merging. Every path below is published to a" \
    "# public site. Keep only what the site needs at run time; see the notes after this one." \
    "#"
  while IFS= read -r raw || [ -n "$raw" ]; do
    line="${raw%$'\r'}"
    case "$line" in
      /index.html) printf '%s\n' "$line" ;;
      */) if has_publishable_file ".$line"; then printf '%s\n' "$line"; fi ;;
      /*) if [ -f ".$line" ]; then printf '%s\n' "$line"; fi ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$tpl"
}

case "${1:-}" in
  assemble) shift; cmd_assemble "$@" ;;
  verify)   shift; cmd_verify "$@" ;;
  check)    shift; cmd_check "$@" ;;
  live)     shift; cmd_live "$@" ;;
  default)  shift; cmd_default "$@" ;;
  *)
    echo "usage: deploy-publish.sh assemble [DIR] | verify DIR | check | live URL | default TEMPLATE" >&2
    exit 2
    ;;
esac
