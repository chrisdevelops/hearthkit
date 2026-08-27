#!/usr/bin/env bash
# Enforce file ownership for subagent roles. Runs as a PreToolUse hook on
# Edit and Write. Usage in agent frontmatter:
#   command: ".claude/hooks/enforce-file-ownership.sh gate-writer"
# Exit 2 blocks the tool call and returns the message to the subagent.
# Uses node (already required by the repo) to parse the JSON; no jq needed.
# Paths are matched relative to the repo root.

set -euo pipefail

ROLE="${1:-}"
FILE="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch{}})')"

if [ -z "$FILE" ]; then
  exit 0
fi

# Normalise to a repo-relative path.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REL="${FILE#"$REPO_ROOT"/}"

block() {
  echo "Ownership violation: role '$ROLE' may not edit '$REL'. $1" >&2
  exit 2
}

case "$ROLE" in
  contract-author)
    case "$REL" in
      packages/*/CONTRACT.md) exit 0 ;;
      packages/*/src/*-contract.ts) exit 0 ;;
      *) block "contract-author edits only CONTRACT.md and *-contract.ts." ;;
    esac
    ;;
  gate-writer)
    case "$REL" in
      packages/*/src/*.test.ts) exit 0 ;;
      packages/*/test-fixtures/*) exit 0 ;;
      packages/*/vitest.config.ts) exit 0 ;;
      *) block "gate-writer edits only *.test.ts, test-fixtures, and vitest.config.ts." ;;
    esac
    ;;
  implementor)
    case "$REL" in
      *.test.ts) block "Gates are owned by gate-writer. Report the problem instead." ;;
      *-contract.ts) block "Contracts are owned by contract-author. Report the problem instead." ;;
      */CONTRACT.md) block "Contracts are owned by contract-author. Report the problem instead." ;;
      .claude/*) block "Agent configuration is owned by the user." ;;
      docs/PLAN.md|docs/STATUS.md) block "Plan and status are owned by the orchestrator." ;;
      *) exit 0 ;;
    esac
    ;;
  gate-runner)
    case "$REL" in
      .reports/*) exit 0 ;;
      *) block "gate-runner writes only to .reports/." ;;
    esac
    ;;
  *)
    echo "enforce-file-ownership: unknown role '$ROLE'" >&2
    exit 2
    ;;
esac
