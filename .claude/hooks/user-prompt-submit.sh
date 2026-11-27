#!/usr/bin/env bash
# user-prompt-submit.sh: appends each of Tim's prompts to the day's
# transcript, one file per day under .claude/transcripts/.

input=$(cat)
prompt=$(printf '%s' "$input" | jq -r '.user_prompt // .prompt // ""' 2>/dev/null)
[ -n "$prompt" ] || exit 0

dir="$CLAUDE_PROJECT_DIR/.claude/transcripts"
mkdir -p "$dir"
file="$dir/$(date '+%Y-%m-%d').md"
[ -f "$file" ] || printf '# Transcript: %s\n\n' "$(date '+%Y-%m-%d')" > "$file"
printf -- '## %s\n\n%s\n\n' "$(date '+%H:%M:%S')" "$prompt" >> "$file"
exit 0
