---
name: api-surface-audit
description: >
  Audit the public API surface of the zod-nest library — verify every export in `src/index.ts` resolves to a file in `src/<area>/`, has a matching test in `test/<area>/<name>.spec.ts`, and follows the project's naming conventions (`<Name>Exception` for thrown classes, `x-zod-nest-*` for OpenAPI extension keys, `Symbol.for('zod-nest.*')` for symbols). Use this skill before cutting a release, after adding or renaming a public export, after refactoring a module, when reviewing a PR that touches `src/index.ts` or any per-area `index.ts`, or any time you suspect the public surface might have drifted from its tests or conventions. The skill emits a line-anchored checklist; a clean checklist is the gate for shipping.
---

# api-surface-audit

Verifies higher-level hygiene of the zod-nest public API surface — the kinds of issues that `tsc` and `eslint` don't flag because they're consistency / coverage concerns rather than type / syntax errors.

**Assumes `npm run typecheck` and `npm run lint` are already green.** This skill doesn't re-do what those tools already catch (missing imports, broken re-exports, type mismatches, lint violations). Run them first.

## When to invoke

- **Before cutting a release.** A clean audit = the surface ships consistently.
- **After adding or renaming a public export.** Catches missing tests and convention drift at PR time, not at release.
- **After refactoring a module.** Verifies per-area re-exports are still serving a purpose (no orphans).
- **When reviewing a PR that touches `src/index.ts` or any `src/*/index.ts`.** The diff alone doesn't show convention adherence or test coverage.

## Output contract

A markdown checklist of diagnostics, grouped into 4 categories. Each item carries a `path:line` anchor and a short proposed fix. If every category is clean, the report is a single `✅ Public API surface clean` line.

| Category | What's checked | Why tsc/eslint doesn't already do it |
|---|---|---|
| 🧪 **Missing test** | Public export has no matching `test/<area>/<name>.spec.ts` (or no `*.spec.ts` in `test/<area>/` mentions the symbol). | Compilers don't know what "tested" means; we encode project convention instead. |
| 🏷️ **Naming convention** | Symbol violates a project convention (`<Name>Exception`, `<Name>Error`, `x-zod-nest-*`, `Symbol.for('zod-nest.*')`). | ESLint can enforce naming patterns, but none of the off-the-shelf rules know that *thrown HTTP classes* are `Exception` vs *raised non-HTTP errors* are `Error`. |
| 🔀 **Orphan re-export** | `src/<area>/index.ts` re-exports a symbol that `src/index.ts` doesn't surface, and nothing outside `src/<area>/` consumes it. | TypeScript treats this as a valid export — it isn't unused at the *type* level. But for a small public-API library, every export should serve a public or cross-area purpose. |
| ✅ **In sync** | Per-area sweep that passes all checks (one terse line per area). | n/a |

## Workflow

### Step 1: Collect the public surface

Read `src/index.ts` and capture every exported name, grouped by area (which `./<area>/index.js` it came from). Because the skill assumes typecheck is already green, you don't need to verify the names resolve — `tsc` has done that. Just collect the inventory.

### Step 2: Check naming conventions

For each public name, apply the convention rules:

| Pattern | Convention | Example |
|---|---|---|
| Exception class (extends `HttpException` or subclass) | `<Name>Exception` | `ZodValidationException`, `ZodSerializationException` |
| Non-HTTP error class (extends `Error`) | `<Name>Error` | `ZodNestError`, `ZodNestUnrepresentableError`, `ZodNestDocumentError` |
| OpenAPI extension key (string constant) | prefix `x-zod-nest-` | `ZOD_NEST_DTO_EXTENSION = 'x-zod-nest-dto'`, `ZOD_NEST_ERROR_EXTENSION = 'x-zod-nest-error'` |
| Reflect-metadata key (symbol constant) | `Symbol.for('zod-nest.<concept>')` | `ZOD_DTO_SYMBOL`, `ZOD_RESPONSES_METADATA_KEY`, `ZOD_NEST_OPTIONS` |

For each violation → 🏷️ **Naming convention** with the rule that was broken.

### Step 3: Check test coverage for each public export

For each public name from Step 1, search `test/<area>/**/*.spec.ts` (where `<area>` matches the export's source module) for the symbol name. The match doesn't need to be a strict 1:1 — many tests cover an export indirectly through other constructs — but the symbol should appear textually in at least one spec file under the same area.

Exceptions to flag explicitly:
- Type-only exports (`export type ...`) need only a type-level spec (`test/<area>/*.types.spec.ts`) referencing them via `InstanceType`, `z.infer`, or a `: TypeName` annotation.
- Compile-only specs use `expect(true).toBe(true)` as their runtime body; that's accepted.

Misses → 🧪 **Missing test** with a one-line proposed spec stub (e.g. *"add `test/dto/<name>.spec.ts` with a basic `parse` round-trip"*).

### Step 4: Check for orphan re-exports

For each `src/<area>/index.ts`, read its export list and identify any name that:

1. Doesn't appear in `src/index.ts`'s re-exports of that area, **and**
2. Isn't consumed by any `src/<other-area>/*.ts` via an import path that goes through this area's index.

Such a symbol is exported from the area but neither public nor cross-area. Two valid resolutions:

- **Intentional internal** — the area re-exports it for its own internal organization (e.g. shared between sibling files in the same area). Acceptable; not flagged.
- **Orphan** — the re-export served a purpose that's since gone (a removed cross-area consumer, a once-public-now-internal export). Flag as 🔀 with a note: *"consider dropping the re-export — no consumers outside the area, not public"*.

Heuristic: grep `import .* from '\.\./<area>(/index)?'` across `src/**/*.ts`. If no `src/<other-area>/*.ts` matches and the name isn't in `src/index.ts`, it's an orphan candidate.

### Step 5: Emit the report

Output the checklist with the items grouped by category. Order severity-first: 🧪 → 🏷️ → 🔀 → ✅. If every category is clean:

```markdown
✅ Public API surface clean — N exports verified across M areas.
```

Otherwise:

```markdown
## API surface audit

🧪 **Missing test**
- `src/dto/new-thing.ts` exports `NewThingDto`. No `test/dto/new-thing*.spec.ts` references it.
  Proposed: add a basic `parse` round-trip spec or document why coverage is intentionally absent.

🏷️ **Naming convention**
- `src/exceptions/api-error.ts` exports `ApiError`. Project convention is `<Name>Error` for non-HTTP errors and `<Name>Exception` for HTTP-thrown classes.
  Decide: rename to `ApiException` (HTTP path) or keep as `ApiError` (non-HTTP).

🔀 **Orphan re-export**
- `src/schema/internal-helper.ts` is re-exported by `src/schema/index.ts:18` but not public and not consumed outside `src/schema/`.
  Consider dropping the re-export.

✅ **In sync** — `src/dto/*`, `src/pipes/*`, `src/interceptors/*`, `src/document/*`, `src/module/*`.
```

Stop after emitting. The user reviews and decides per item.

## Out of scope

- **Deep type-shape audits.** Verifying that a function's parameter types haven't changed shape is `/check-upstream-updates` territory, not this skill.
- **Doc coverage.** That's `/sync-docs`.
- **Test quality.** This skill checks for *presence* of a test, not whether the test is good.
- **Internal-module-only refactors.** If `src/index.ts` doesn't change and no per-area `index.ts` changes, the public surface didn't shift — running this skill is optional.

## Notes

- The skill is a *gate*, not a continuous monitor. Invoke it at the natural inflection points (release prep, surface changes, refactors), not on every edit.
- Convention rules live in the body of this skill, not in a reference file — they're stable enough that inline is fine. If new conventions are added (e.g., a new prefix for a new kind of construct), update the table in Step 2.
