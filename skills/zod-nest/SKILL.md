---
name: zod-nest
description: >
  Best-practices diagnostics for projects using the `zod-nest` library — schema
  naming, `@ZodResponse` ergonomics, and `overrideJSONSchema` opportunities for
  unrepresentable types (file uploads, opaque blobs, custom-typed fields).
  Surfaces a prioritized checklist of proposed edits; never auto-applies. Use
  in a project that depends on `zod-nest`, when editing any `.ts` file that
  imports from `zod-nest` / `zod-nest/helpers`, OR any `.ts` file that imports
  from `zod` and exports a schema — controllers, DTO files, schema files
  (commonly `schemas.ts` / `*.schema.ts` / `*.dto.ts`), or anywhere
  `createZodDto` / `@ZodResponse` / `overrideJSONSchema` lives or the schemas
  it consumes live. Also slash-invokable when the user says "review my
  zod-nest code", "improve my zod schemas", "audit zod-nest usage", "extract
  inline schema", "name this schema for OpenAPI", "missing @ZodResponse",
  "stack @ZodResponse", "leverage zod-nest", "override JSON schema for DTO",
  "unrepresentable type", "z.instanceof in DTO", "fix file upload schema",
  "use FileSchema / BlobSchema / BufferSchema", or "best practices zod-nest".
  Out of scope by design: `passthroughOnError`, custom exception factories,
  `validationLogs` / `redactKeys` / logger config, per-call `Override`
  callbacks on `applyZodNest` (per-emission escape hatch, user-driven). The
  per-instance `overrideJSONSchema` *is* in scope.
---

# zod-nest

Diagnoses missed ergonomics in projects that already use the
[`zod-nest`](https://github.com/rodrigowbazevedo/zod-nest) library — schema
naming for OpenAPI clarity, `@ZodResponse` patterns for handler concision, and
`overrideJSONSchema` registration for schemas that emit `{}` to JSON Schema.
The skill **diagnoses + proposes**; the user (or the agent under user
direction) applies the edits.

## When to invoke

The trigger is a **two-tier predicate**:

1. **Project signal** (gates the skill at all): the project depends on
   `zod-nest`. Detection — first hit wins:
   - `package.json` lists `zod-nest` in `dependencies` / `devDependencies` /
     `peerDependencies`.
   - Any `from 'zod-nest'` or `from 'zod-nest/helpers'` import exists under
     `src/` (one-shot grep at first invocation; cached for the scan).
2. **File signal** (gates per-edit auto-trigger): once the project signal is
   satisfied, auto-trigger on a `.ts` edit when either:
   - The file imports from `zod-nest` or `zod-nest/helpers`, **OR**
   - The file imports from `zod` and defines an **exported** schema (a
     `z.object` / `z.union` / `z.discriminatedUnion` / `z.array` / etc. bound
     to an exported const).

Schemas commonly live in `zod`-only files (no `zod-nest` import) that are
consumed by `createZodDto(...)` one file over — that's why the file signal
covers both.

- **Slash-invokable** as `/zod-nest` from any file in a `zod-nest`-using
  project; `/zod-nest <path>` scopes the scan to that path.
- **Never on file edits in a non-`zod-nest` project** — if the project signal
  fails, the skill stays silent.
- **`*.module.ts` / `main.ts`** stay slash-only — they reach the skill via
  invocation rather than auto-trigger, but the skill _does_ read them for the
  `strict`-flag probe described below.

### Per-section routing

Inside a triggered file, the skill picks the relevant rule subset based on
what's actually there:

- **Handler-ergonomics rules** fire only when the file has `@Controller`
  (or `@Get` / `@Post` / `@Put` / `@Delete` / `@Patch` / etc.).
- **Schema-ergonomics rules** (including Rule 5 below) fire on any file that
  defines a Zod schema reachable from a DTO. For schema-only files (no
  `createZodDto` in the same file), schema rules still fire when the schema
  is **exported** — suppress when the schema is module-local (it never
  reaches the OpenAPI doc).

## Output contract

One markdown checklist, grouped into two sections. Each item carries:

- A **severity glyph** — `🟢` (suggestion / nice-to-have), `🟡` (likely
  improvement), `🔴` (clear miss).
- A **file:line anchor** pointing at the relevant source location.
- A **proposed edit** — either a unified-diff hunk or a concrete sentence
  describing the change. **Do not apply.**

Sections:

1. **Schema ergonomics** — `.meta({ id })` naming, inline `z.object`
   hoisting, shared-shape unification, `extend()` composition opportunities,
   and **unrepresentable schemas exposed via a DTO without
   `overrideJSONSchema`** (Rule 5 — new).
2. **Handler ergonomics** — missing `@ZodResponse`, multi-status candidates,
   redundant `@ApiResponse` next to a `@ZodResponse`.

If nothing fires, output a single line: `✅ zod-nest usage looks healthy — no
diagnostics for this change.` and stop.

## Workflow

### Step 0 — project probe (one-shot, cached)

Before running diagnostics, the agent performs two one-shot greps and caches
the results for the duration of the scan:

1. **Project signal**: confirm `zod-nest` is in `package.json` (or that any
   `from 'zod-nest'` import exists under `src/`). If neither, exit silently.
2. **`strict` setting**: grep `applyZodNest(...)` (typically in `src/main.ts`
   or `src/bootstrap.ts`) for an explicit `strict: false`. Default is
   `strict: true` if not stated. Used by Rule 5 to pick severity.

### Step 1 — bound the scan

Identify the files in scope:

- **Default**: the file the user just edited (the auto-trigger entry point),
  if it satisfies the file signal.
- **`/zod-nest` invocation without a file argument**: scan all `.ts` files
  under the project that satisfy the file signal (zod-nest importers +
  zod-only files exporting schemas).
- **`/zod-nest <file>` invocation**: that file only.

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
   verbatim:** _"`@experimental` — output shape may change as edge cases
   surface. Pin a minor version if you build production tooling on top of
   this surface."_ See <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/composition.md>.
5. **Unrepresentable schema exposed via DTO without `overrideJSONSchema`** —
   a schema using `z.custom(...)`, `z.instanceof(...)`, or a bare
   `.transform(...)` flows into `createZodDto` / `@ZodResponse` / `@Body` /
   `@Query` / `@Param` / `@Headers` without a covering registration. The
   proposed edit reaches for `zod-nest/helpers` (`FileSchema` / `BlobSchema`
   / `BufferSchema` presets, or the fragment catalog like `binaryFragment` /
   `uuidFragment` / `opaqueFragment`). Severity depends on the project's
   `strict` setting (from Step 0). See the canonical recipe at
   <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/recipes/custom-openapi-overrides.md>.

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
   as the canonical replacement (`BlobSchema` from `zod-nest/helpers` +
   `@ZodResponse({ type: BlobDto })`).

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

🔴 `src/uploads/upload.dto.ts:5` — `z.instanceof(File)` inside `createZodDto`
with no `overrideJSONSchema` registration; project runs `strict: true`,
so this will throw `ZodNestUnrepresentableError` at `applyZodNest` time.
Proposed: import `FileSchema` from `zod-nest/helpers` and use it directly:
`class UploadDto extends createZodDto(z.object({ file: FileSchema })) {}`.

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
- **Per-call `Override` callback on `applyZodNest`** — the per-emission
  escape hatch is user-driven; the skill doesn't suggest writing or
  modifying it. (The _per-instance_ `overrideJSONSchema` registration is in
  scope via Rule 5.)
- **Auto-applying edits** — diagnostic only. User owns the wording.

## Notes

- This skill is for _consumers of_ `zod-nest`. For contributing to the
  library itself, see the contributor skills at
  <https://github.com/rodrigowbazevedo/zod-nest/tree/main/.claude/skills>.
- Detection rules are conservative — false positives erode trust faster than
  false negatives. Tighten before widening.
