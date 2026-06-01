---
name: sync-docs
description: >
  Diagnose drift between src/ code changes and user-facing docs (README, docs/, MIGRATION.md) on the current branch in the zod-nest repo. Surfaces a checklist of proposed edits with file:line anchors — never auto-writes. Use whenever the user edits files under `src/`, adds or removes a public export from `src/index.ts`, changes a default behavior (option shape, response body, log payload), updates `package.json` peer dependencies, or before running `gh pr create` on a branch with src/ changes. Use proactively any time the public API surface shifts, even if the user doesn't explicitly say "check the docs" — drift between code and docs is the failure mode this skill exists to catch.
---

# sync-docs

Catches docs that have fallen out of sync with the code on the current branch. The skill **diagnoses + proposes**; the user (or Claude under user direction) applies the edits.

## When to invoke

- **Proactively** after editing files under `src/` — especially `src/index.ts` (public exports) or any `src/<area>/index.ts` (per-area re-exports).
- **Before `gh pr create`** when the branch has src/ changes. The PreToolUse hook in `.claude/settings.json` blocks PR creation if docs drift is detected and no opt-out is set — running this skill is the natural way to clear the block.
- **Whenever the public surface shifts** — a new public export, a renamed symbol, a removed helper, a default-value change, an exception body change, a new module option.

## Output contract

Two sections:

1. **Drift report** — one markdown checklist with one bullet per drift item:
   - 📝 **Missing** — docs don't mention a new public export or behavior.
   - ⚠️ **Broken reference** — docs name a symbol that has been renamed or removed.
   - 🔄 **Behavior drift** — docs describe a default / option / shape that no longer matches code.
   - ✅ **In sync** — area was checked and no drift found (one terse line per area).
   - Each non-✅ bullet includes a `path/to/doc.md:LINE` anchor and a **proposed edit** (unified-diff hunk or concrete sentence rewrite). Don't auto-apply.

2. **Version-bump implications** — surfaces only when public-API or behavior-shape changes are detected (see Step 4 for detection rules). Recommends the conventional-commit prefix the next squash-merge should use so semantic-release computes the right bump. Always advisory — the user owns the final commit message.

If everything is in sync and no breaking changes are detected, output a single `✅ Docs in sync — no breaking changes` line and stop.

## Workflow

### Step 1: Compute the changeset

Run `git diff --name-only main..HEAD` (or `git diff --name-only origin/main..HEAD` if `main` doesn't exist locally). Bucket the changed files:

- **public-surface** — `src/index.ts` or any `src/*/index.ts` (per-area re-exports).
- **behavior** — `src/**/*.ts` excluding the index files. Check the accompanying `test/**/*.spec.ts` diffs for clues about what semantics changed.
- **peers** — `package.json` peerDependencies or engines.

If the branch is at the merge base (no diff), output `✅ Docs in sync — no src changes on this branch` and stop.

### Step 2: Re-discover the doc layout

**Do NOT hardcode the doc paths.** The Phase 3 docs were shipped with more files than the original Phase 4 plan anticipated, and future phases may add or rename more.

Read [`references/doc-layout.md`](references/doc-layout.md) for the current canonical mapping of `src/` areas to `docs/` files. Then verify each referenced file actually exists in the worktree (`ls docs/*.md docs/recipes/*.md`). Drop any reference doc that no longer exists; flag any new `docs/*.md` not in the mapping as a follow-up for the human to slot into `doc-layout.md`.

### Step 3: Map buckets → docs

For each bucket from Step 1, identify which docs are affected:

- **public-surface changes** → README.md (Features list, Differences from `nestjs-zod` notes, API reference table, Documentation index), the per-area companion doc(s) the new/changed export belongs to, MIGRATION.md (breaking-changes table if behaviour-changing).
- **behavior changes** → the per-area companion doc, plus MIGRATION.md if it's a breaking change, plus any `docs/recipes/*.md` that demos the affected behavior.
- **peer-dep changes** → README.md install/peers, MIGRATION.md Prerequisites section, CONTRIBUTING.md local-setup section.

Use the source-of-truth principle: `src/index.ts` lists what's public. If an export is new or renamed there, the README's API-reference table needs to reflect it.

### Step 4: Scan each affected doc

For each doc identified in Step 3:

1. **Broken references** — grep the doc for every symbol name removed or renamed in the changeset. Each match is a ⚠️ item. **Removals and renames of public exports also feed Step 5.**
2. **Drifted defaults** — find sentences describing default behaviour (e.g. "default is `4096`", "redacts `password`, `secret`, `apiKey`", "returns 400 with body `{ ... }`"). Cross-reference the actual default in code. Each mismatch is a 🔄 item. **Default-shape changes also feed Step 5.**
3. **Missing coverage** — for each new export or behavior, search the doc for its name. If absent and the doc is one where it _should_ appear (e.g. a new exception class missing from `docs/exceptions.md`), emit a 📝 item with a proposed paragraph or table row.
4. **Comparison-table staleness** — README's "Differences from `nestjs-zod`" section and MIGRATION.md's breaking-changes table have rows. If a behaviour described there has changed, flag the row.

### Step 5: Classify each change's version-bump impact

Before emitting the report, classify the changes detected in Steps 1 and 4 into three buckets:

- **Breaking** — any of:
  - A symbol removed from `src/index.ts` (or any `src/*/index.ts` re-export) that was previously exported.
  - A symbol renamed in the public surface (e.g. `createZodGuard` → something else).
  - A response-body shape change on an exception class (a key removed or its type changed).
  - A default value change that flips client-visible behaviour (e.g. `passthroughOnError` default flipped, exception status changed).
  - A signature change on a public function or class constructor that's not backwards-compatible.
- **Feature** — any of:
  - A new export from `src/index.ts`.
  - A new option on an existing public type (additive, backwards-compatible).
  - A new method or property on a public class.
- **Patch / docs-only** — internal refactors, bug fixes, comment edits, doc-only changes. None of the above.

If at least one **Breaking** change is present, the recommended conventional-commit prefix on the squash-merge title is `feat!:` (or `fix!:`, depending on the kind of change) **and** the PR body should carry a `BREAKING CHANGE:` footer naming the affected public surface. semantic-release reads the footer to pull the breaking-change line into `CHANGELOG.md`.

If only **Feature** changes are present, the prefix is `feat:` (minor bump).

If only **Patch / docs-only** changes are present, the prefix is `fix:` / `docs:` / `chore:` etc. (no bump for docs/chore, patch bump for fix).

Pre-1.0 caveat: per semver, 0.x minor bumps **can** include breaking changes. semantic-release still computes 0.x.y → 0.(x+1).0 for a `feat:` commit pre-1.0, even with a `BREAKING CHANGE:` footer — the footer's effect at pre-1.0 is to surface the breaking note in `CHANGELOG.md` rather than to force a major bump. The skill always recommends the footer when a breaking change is detected; the user decides whether to omit it.

### Step 6: Emit the report

Two sections — the drift checklist followed by the version-bump implications. Skip the second section entirely when Step 5 found only Patch / docs-only changes.

```markdown
## Drift report

📝 **Missing**

- `docs/exceptions.md:13` — `ZodNestDocumentError` not in the class hierarchy diagram.
  Proposed: add `└── ZodNestDocumentError (applyZodNest post-processing failures)` to the tree.

⚠️ **Broken reference**

- `MIGRATION.md:142` — references removed export `createZodGuard`. Drop the row or note it's intentionally gone.

🔄 **Behavior drift**

- `docs/module-options.md:118` — `DEFAULT_REDACT_KEYS` lists 8 entries; code now ships 11.
  Proposed: refresh the table from `src/module/options.ts:68-83`.

✅ **In sync** — docs/composition.md, docs/recipes/\*, CONTRIBUTING.md

## Version-bump implications

This branch contains **breaking** changes to the public surface:

- Removed export: `createZodGuard` (was in `src/index.ts`).
- Response body shape: `ZodSerializationException` no longer includes `errors`.

Recommended squash-merge title prefix: **`feat!:`** (or `fix!:`)
PR body should include a `BREAKING CHANGE:` footer naming each affected symbol so semantic-release surfaces it in `CHANGELOG.md`.

(Pre-1.0 note: at `0.x`, a breaking change still results in a minor bump — `0.7.0` → `0.8.0` — not a major. The `BREAKING CHANGE:` footer is still recommended for the changelog entry.)
```

Stop after emitting the report. Do not apply edits — the user reviews, decides, and applies (or asks Claude to apply per item).

## Out of scope

- **Auto-applying edits.** This skill is diagnostic. The user owns the final wording.
- **Changelog generation.** That's `semantic-release`'s job at release time.
- **`CHANGELOG.md` updates.** Same reason.
- **Doc-only changes.** If the branch's diff has no `src/` changes, the skill skips immediately.

## Notes

- The doc layout convention is in [`references/doc-layout.md`](references/doc-layout.md). Update it when phases add or rename companion docs.
- The skill exists because contributor-driven src/ changes routinely outpace doc updates — by surfacing the gap _before_ `gh pr create`, the docs stay honest as part of the same change.
