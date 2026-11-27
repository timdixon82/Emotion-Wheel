#!/usr/bin/env bash
# token-report.sh: report token use from Claude Code session transcripts.
#
# Claude Code writes one JSONL transcript per session under
# ~/.claude/projects/<project-slug>/, and one per subagent under
# <session-id>/subagents/. Each assistant message carries a usage block. A
# message streamed in several parts repeats the same message id, so usage is
# counted once per id. Decision 023.
#
# Usage:
#   bash scripts/token-report.sh                 # latest session of this project, with its subagents
#   bash scripts/token-report.sh <file.jsonl>... # named transcripts
#   bash scripts/token-report.sh --last-turn <file.jsonl>
#                                                # one number: tokens since the last real user prompt
#   bash scripts/token-report.sh --total <file.jsonl>
#                                                # one number: all tokens in the file
#
# "Tokens" is input + cache write + cache read + output. The breakdown is
# printed because cache reads are much cheaper than the other three.
#
# Exit codes: 0 success, 1 no transcript found, 2 jq missing.

set -u

command -v jq >/dev/null 2>&1 || { echo "token-report.sh: jq is required." >&2; exit 2; }

# jq program: deduplicated usage rows (input, cache write, cache read, output).
JQ_ROWS='
  [ .[] | select(.type == "assistant" and (.message.usage? != null)) ]
  | unique_by(.message.id)
  | map(.message.usage
        | [ (.input_tokens // 0), (.cache_creation_input_tokens // 0),
            (.cache_read_input_tokens // 0), (.output_tokens // 0) ])'

_sum_file() {
  # Prints: turns input cache_write cache_read output
  jq -rs "$JQ_ROWS"' | [ length,
      (map(.[0]) | add // 0), (map(.[1]) | add // 0),
      (map(.[2]) | add // 0), (map(.[3]) | add // 0) ] | @tsv' "$1" 2>/dev/null
}

_last_turn() {
  # Assistant usage after the last user entry that is a real prompt, not a tool result.
  jq -rs '
    . as $all
    | ([ range(0; length) as $i
         | select($all[$i].type == "user"
             and (($all[$i].message.content | type) == "string"
                  or (($all[$i].message.content | type) == "array"
                      and ([ $all[$i].message.content[] | .type? ] | index("tool_result") | not))))
         | $i ] | last // -1) as $start
    | [ $all[($start + 1):][] ]
    | '"$JQ_ROWS"'
    | map(add) | add // 0' "$1" 2>/dev/null
}

case "${1:-}" in
  --last-turn|--total)
    mode="$1"; f="${2:-}"
    [ -f "$f" ] || { echo "0"; exit 1; }
    if [ "$mode" = "--last-turn" ]; then
      _last_turn "$f"
    else
      _sum_file "$f" | awk -F'\t' '{print $2 + $3 + $4 + $5}'
    fi
    exit 0
    ;;
esac

files=()
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  proj="${CLAUDE_PROJECT_DIR:-$(pwd)}"
  slug=$(printf '%s' "$proj" | sed 's/[^A-Za-z0-9]/-/g')
  dir="$HOME/.claude/projects/$slug"
  latest=$(ls -t "$dir"/*.jsonl 2>/dev/null | head -1)
  [ -n "$latest" ] || { echo "No transcripts found in $dir"; exit 1; }
  files=("$latest")
  sub_dir="${latest%.jsonl}/subagents"
  if [ -d "$sub_dir" ]; then
    for s in "$sub_dir"/*.jsonl; do [ -f "$s" ] && files+=("$s"); done
  fi
fi

tt=0; ti=0; tw=0; tr=0; to=0
echo "Token report (input, cache write, cache read, output):"
for f in "${files[@]}"; do
  [ -f "$f" ] || { echo "- $(basename "$f"): not found"; continue; }
  row=$(_sum_file "$f")
  [ -n "$row" ] || { echo "- $(basename "$f"): unreadable"; continue; }
  IFS=$'\t' read -r turns i w r o <<< "$row"
  total=$(( i + w + r + o ))
  label=$(basename "$f" .jsonl)
  printf -- '- %s: %d tokens over %d messages (%d, %d, %d, %d).\n' \
    "$label" "$total" "$turns" "$i" "$w" "$r" "$o"
  tt=$(( tt + total )); ti=$(( ti + i )); tw=$(( tw + w )); tr=$(( tr + r )); to=$(( to + o ))
done
printf 'Total: %d tokens (input %d, cache write %d, cache read %d, output %d).\n' \
  "$tt" "$ti" "$tw" "$tr" "$to"
