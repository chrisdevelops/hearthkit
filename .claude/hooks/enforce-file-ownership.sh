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

# Paths outside the repo are not owned by anyone: a gate-writer may prove its gates satisfiable
# with a throwaway implementation in the scratchpad, and nothing there can reach main.
case "$FILE" in
  "$REPO_ROOT"/*) ;;
  *) exit 0 ;;
esac

block() {
  echo "Ownership violation: role '$ROLE' may not edit '$REL'. $1" >&2
  exit 2
}

case "$ROLE" in
  contract-author)
    case "$REL" in
      packages/*/CONTRACT.md|templates/*/CONTRACT.md) exit 0 ;;
      # Step 6.1: the infra provider contract lives outside packages/ and templates/.
      infra/tofu/PROVIDER-CONTRACT.md) exit 0 ;;
      packages/*/src/*-contract.ts|templates/*/src/*-contract.ts) exit 0 ;;
      *) block "contract-author edits only CONTRACT.md and *-contract.ts, under packages/ or templates/." ;;
    esac
    ;;
  gate-writer)
    case "$REL" in
      packages/*/src/*.test.ts|templates/*/src/*.test.ts) exit 0 ;;
      packages/*/test-fixtures/*|templates/*/test-fixtures/*) exit 0 ;;
      # .mts is needed where the package has no "type": "module" — Vite's native
      # config loader errors on ESM syntax in a file it loads as CommonJS.
      packages/*/vitest.config.ts|packages/*/vitest.config.mts) exit 0 ;;
      templates/*/vitest.config.ts|templates/*/vitest.config.mts) exit 0 ;;
      # Template gates are Playwright specs plus their config; they run against a
      # built container, not against compose services like package gates do.
      templates/*/e2e/*.spec.ts) exit 0 ;;
      templates/*/playwright.config.ts) exit 0 ;;
      *) block "gate-writer edits only *.test.ts, e2e/*.spec.ts, test-fixtures, vitest.config.ts, and playwright.config.ts, under packages/ or templates/." ;;
    esac
    ;;
  implementor)
    case "$REL" in
      *.test.ts) block "Gates are owned by gate-writer. Report the problem instead." ;;
      # Template gates are Playwright specs, not *.test.ts, so they need naming here.
      # The vitest/playwright configs decide which tier a gate runs in, so they are
      # gate-writer's too — an implementor must not be able to widen or narrow them.
      *.spec.ts|*/playwright.config.ts) block "Gates are owned by gate-writer. Report the problem instead." ;;
      */vitest.config.ts|*/vitest.config.mts) block "Gate configuration is owned by gate-writer. Report the problem instead." ;;
      */test-fixtures/*) block "Gate fixtures are owned by gate-writer. Report the problem instead." ;;
      *-contract.ts) block "Contracts are owned by contract-author. Report the problem instead." ;;
      */CONTRACT.md) block "Contracts are owned by contract-author. Report the problem instead." ;;
      infra/tofu/PROVIDER-CONTRACT.md) block "Contracts are owned by contract-author. Report the problem instead." ;;
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
