#!/usr/bin/env bash
#
# PreToolUse hook for `gh pr create`. Reads the Bash tool's CLAUDE_TOOL_INPUT
# JSON, identifies whether the command is a `gh pr create ...` invocation,
# and runs two pre-PR sanity checks against the current branch's diff vs main.
#
# Exit codes:
#   0  — not a `gh pr create` command, or checks passed, or bypass env var set.
#   1  — at least one check fired; reminders printed to stderr.
#
# Bypass for refactor-only PRs that genuinely don't need docs / API audit:
#   export ZOD_NEST_SKIP_PRE_PR_CHECKS=1
#
# Wired in `.claude/settings.json` (PreToolUse → Bash).

set -u

COMMAND=$(jq -r '.tool_input.command // empty' <<< "${CLAUDE_TOOL_INPUT:-}")

case "$COMMAND" in
  "gh pr create"*) ;;
  *) exit 0 ;;
esac

if [ "${ZOD_NEST_SKIP_PRE_PR_CHECKS:-}" = "1" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

BLOCKED=0

# Check 1 — docs drift
SRC=$(git diff --name-only main..HEAD 2>/dev/null | grep -c '^src/' || true)
DOCS=$(git diff --name-only main..HEAD 2>/dev/null | grep -cE '^(README\.md|docs/|MIGRATION\.md)' || true)
if [ "$SRC" -gt 0 ] && [ "$DOCS" -eq 0 ]; then
  echo "[zod-nest] src/ changed without README/docs/MIGRATION updates. Run /sync-docs first." >&2
  BLOCKED=1
fi

# Check 2 — public API surface drift
SURFACE=$(git diff --name-only main..HEAD 2>/dev/null | grep -cE '^src/index\.ts$|^src/[^/]+/index\.ts$' || true)
if [ "$SURFACE" -gt 0 ]; then
  echo "[zod-nest] Public API surface changed (src/index.ts or src/<area>/index.ts). Run /api-surface-audit before opening the PR." >&2
  BLOCKED=1
fi

if [ "$BLOCKED" -eq 1 ]; then
  echo "[zod-nest] (bypass with ZOD_NEST_SKIP_PRE_PR_CHECKS=1)" >&2
  exit 1
fi

exit 0
