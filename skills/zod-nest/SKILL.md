---
name: zod-nest
description: >
  Best-practices diagnostics for projects using the `zod-nest` library — schema
  naming + `@ZodResponse` ergonomics. Surfaces a prioritized checklist of
  proposed edits; never auto-applies. Use when editing a `*.controller.ts` or
  `*.dto.ts` file that imports from `zod-nest`. Also slash-invokable when the
  user says "review my zod-nest code", "improve my zod schemas", "audit
  zod-nest usage", "extract inline schema", "name this schema for OpenAPI",
  "missing @ZodResponse", "stack @ZodResponse", "leverage zod-nest", or "best
  practices zod-nest". Out of scope by design: `passthroughOnError`, custom
  exception factories, `validationLogs` / `redactKeys` / logger config,
  `Override` callbacks — the skill avoids opinions on those knobs.
---

# zod-nest

Diagnoses missed ergonomics in projects that already use the
[`zod-nest`](https://github.com/rodrigowbazevedo/zod-nest) library — schema
naming for OpenAPI clarity, and `@ZodResponse` patterns for handler concision.
The skill **diagnoses + proposes**; the user (or the agent under user
direction) applies the edits.

## When to invoke

- **Auto-trigger** when editing a `*.controller.ts` or `*.dto.ts` file that
  imports from `zod-nest`. Scope is intentionally tight — `*.module.ts` and
  `main.ts` reach this skill via slash invocation only.
- **Slash-invokable** as `/zod-nest` from any file in a `zod-nest`-using
  project.
- **Never on file edits that don't import from `zod-nest`** — the diagnostics
  only make sense for code that's already using the library.

## Output contract

One markdown checklist, grouped into two sections. Each item carries:

- A **severity glyph** — `🟢` (suggestion / nice-to-have), `🟡` (likely
  improvement), `🔴` (clear miss).
- A **file:line anchor** pointing at the relevant source location.
- A **proposed edit** — either a unified-diff hunk or a concrete sentence
  describing the change. **Do not apply.**

Sections:

1. **Schema ergonomics** — `.meta({ id })` naming, inline `z.object` hoisting,
   shared-shape unification, `extend()` composition opportunities.
2. **Handler ergonomics** — missing `@ZodResponse`, multi-status candidates,
   redundant `@ApiOkResponse` next to a `@ZodResponse`.

If nothing fires, output a single line: `✅ zod-nest usage looks healthy — no
diagnostics for this change.` and stop.

## Workflow

### Step 1 — bound the scan

Identify the files in scope:

- **Default**: the file the user just edited (the auto-trigger entry point).
- **`/zod-nest` invocation without a file argument**: scan all
  `**/*.controller.ts` and `**/*.dto.ts` under the project that import from
  `zod-nest`.
- **`/zod-nest <file>` invocation**: that file only.

Skip files that don't import from `zod-nest` — they're out of scope.

### Step 2 — schema diagnostics

Read [`references/schema-ergonomics.md`](references/schema-ergonomics.md) for
the full rule catalog. The diagnostics:

1. **Missing `.meta({ id })` on reused schemas** — a `z.object(...)` const
   referenced by ≥ 2 `createZodDto(...)` callsites (anywhere in the project)
   should have `.meta({ id: 'PascalName' })`. Without it, OpenAPI gets
   anonymous `$ref` chains.
2. **Inline `z.object(...)` inside `createZodDto`** — non-trivial inline
   shapes (more than 2 fields, or used in more than one DTO) should be
   hoisted to a named const with `.meta({ id })`.
3. **Anonymous shared shapes** — heuristic match: same keys + same Zod types
   across multiple files. Suggest unifying.
4. **Composition opportunity** — when two schemas share a field prefix,
   suggest `extend()` from `zod-nest`. **Carry the `@experimental` caveat
   verbatim:** *"`@experimental` — output shape may change as edge cases
   surface. Pin a minor version if you build production tooling on top of
   this surface."* See <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/composition.md>.

### Step 3 — handler diagnostics

Read [`references/handler-ergonomics.md`](references/handler-ergonomics.md)
for the full rule catalog. The diagnostics:

1. **Missing `@ZodResponse`** — handler return type is a class extending
   `createZodDto(...)` but no `@ZodResponse(...)` decorator is present.
2. **Multi-status candidate** — handler has multiple `@ApiResponse` (or
   `@ApiOkResponse` / `@ApiNotFoundResponse` / etc.) calls but only one
   `@ZodResponse`. Suggest stacking `@ZodResponse` per status.
3. **Redundant `@ApiResponse({ type })` next to `@ZodResponse({ type })`** —
   since `zod-nest@1.4.0`, `@ZodResponse` is a composite decorator that
   applies `@ApiResponse(...)` internally. Any `@ApiResponse` /
   `@ApiOkResponse` / `@ApiCreatedResponse` (etc.) sitting alongside a
   `@ZodResponse` for the same status and same DTO is now redundant — drop
   the manual `@Api*Response` call. Exception: if the manual call carries
   additional info `@ZodResponse` can't express (e.g. `content:
   'application/octet-stream'` for binary downloads pre-migration), surface
   the [binary downloads recipe](https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/recipes/binary-downloads.md)
   as the canonical replacement (`overrideJSONSchema(BlobSchema, { ... })`
   + `@ZodResponse({ type: BlobDto })`).

### Step 4 — emit the checklist

Group by section. Per item: severity glyph, file:line anchor, one-line
description, proposed edit. Example:

```markdown
## Schema ergonomics

🟡 `src/users/user.dto.ts:8` — `userSchema` is referenced by `UserDto` and
   `AdminDto` but has no `.meta({ id })`.
   Proposed: `.meta({ id: 'User' })` on the schema const.

🟢 `src/orders/order.dto.ts:12` — inline `z.object({ ... })` (4 fields) inside
   `createZodDto`. Consider hoisting + naming.

## Handler ergonomics

🔴 `src/users/users.controller.ts:24` — handler returns `UserDto` but no
   `@ZodResponse` decorator. Response is not validated.
   Proposed: `@ZodResponse({ type: UserDto })` above the method.

🟡 `src/users/users.controller.ts:30` — single `@ZodResponse({ type: UserDto })`
   but `@ApiNotFoundResponse({ type: ErrorDto })` is also present. Suggest
   stacking: `@ZodResponse({ status: 404, type: ErrorDto })`.
```

If nothing fires, the `✅` line from the Output contract is the entire output.

## Out of scope

- **`passthroughOnError` recommendations** — opinionated tradeoff; the skill
  doesn't push a default.
- **Custom exception factories** — `createValidationException` /
  `createSerializationException` are intentional knobs; the skill doesn't
  diagnose their absence or presence.
- **Logging configuration** — `validationLogs`, `redactKeys`, `logger`,
  `maxLoggedValueBytes`. All policy decisions; out of scope.
- **`Override` callback suggestions** — surface only when the schema engine
  legitimately can't represent a type (file uploads, opaque blobs), and the
  user should drive that, not the skill.
- **Auto-applying edits** — diagnostic only. User owns the wording.

## Notes

- This skill is for *consumers of* `zod-nest`. For contributing to the
  library itself, see the contributor skills at
  <https://github.com/rodrigowbazevedo/zod-nest/tree/main/.claude/skills>.
- Detection rules are conservative — false positives erode trust faster than
  false negatives. Tighten before widening.
