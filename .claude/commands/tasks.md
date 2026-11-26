# Show open tasks

Run the task substrate and print Tim's open tasks.

$ARGUMENTS may contain a flag to pass to tasks.sh (e.g. --check or --aged).

Steps:
1. Run `bash scripts/tasks.sh --mine $ARGUMENTS` and print the output.
2. If the output is empty, say "No Tim-facing tasks open."
