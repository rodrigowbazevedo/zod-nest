# schema-ergonomics

Diagnostic catalog for the **Schema ergonomics** section of the `zod-nest`
skill. Each rule below is a thin trigger + canonical-doc URL — the agent
fetches the doc for the full rationale and pattern detail.

## 1. Missing `.meta({ id })` on reused schemas

**Detection** — a `z.object(...)` const (or any `z.*` schema bound to a const)
is referenced by ≥ 2 `createZodDto(...)` callsites across the project, **and**
that schema (or its containing const) has no `.meta({ id: '...' })` call in
its definition.

**Severity** — 🟡 (likely improvement).

**Proposed edit** — append `.meta({ id: 'PascalNameOfConst' })` to the schema.
Use the const name in PascalCase (`userSchema` → `User`,
`createUserRequest` → `CreateUserRequest`).

**Why it matters** — without an `id`, the schema is emitted anonymously
inline in each DTO, bloating the OpenAPI doc and breaking referential
equality for clients.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/dto.md>.

## 2. Inline `z.object(...)` inside `createZodDto`

**Detection** — a `createZodDto(z.object({ ... }))` callsite where the inline
object literal has **more than 2 fields**, _or_ is the same shape as one in
another file.

**Severity** — 🟢 (nice-to-have) for the >2-fields case; 🟡 when shared.

**Proposed edit** — hoist the schema to a named const with `.meta({ id })`,
then `createZodDto(<theConst>)`.

```diff
+ const userSchema = z.object({
+   id: z.uuid(),
+   name: z.string(),
+   email: z.email(),
+ }).meta({ id: 'User' });
+
- export class UserDto extends createZodDto(
-   z.object({ id: z.uuid(), name: z.string(), email: z.email() })
- ) {}
+ export class UserDto extends createZodDto(userSchema) {}
```

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/dto.md>.

## 3. Anonymous shared shapes across files

**Detection** — heuristic match: two or more `z.object({ ... })` literals (or
schema consts) across different files have the same set of keys, where each
key maps to a structurally equivalent Zod type (`z.string()` ↔ `z.string()`,
`z.uuid()` ↔ `z.uuid()`, etc.). The match is structural — different
constraints (e.g. `z.string().min(3)` vs `z.string().min(5)`) count as
different shapes.

**Severity** — 🟢 (suggestion).

**Proposed edit** — surface the duplicates with file:line anchors and suggest
unifying into a single shared schema with `.meta({ id })`. Don't auto-pick a
name; surface candidates.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/dto.md>.

## 4. Composition opportunity — `extend()` candidates

**Detection** — two schemas share a contiguous prefix of fields (same key,
same type, same constraint). The shorter schema's fields are a prefix of the
longer's.

**Severity** — 🟢 (suggestion, opt-in).

**Proposed edit** — suggest using `extend()` from `zod-nest`:

```diff
- const userSchema = z.object({
-   id: z.uuid(),
-   name: z.string(),
- }).meta({ id: 'User' });
-
- const adminSchema = z.object({
-   id: z.uuid(),
-   name: z.string(),
-   permissions: z.array(z.string()),
- }).meta({ id: 'Admin' });
+
+ import { extend } from 'zod-nest';
+
+ const userSchema = z.object({
+   id: z.uuid(),
+   name: z.string(),
+ }).meta({ id: 'User' });
+
+ const adminSchema = extend(userSchema, (b) => ({
+   permissions: z.array(z.string()),
+ })).meta({ id: 'Admin' });
```

**Caveat to carry verbatim** when proposing this edit:

> **`@experimental`** — output shape may change as edge cases surface. Pin a
> minor version if you build production tooling on top of this surface.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/composition.md>.

## 5. Unrepresentable schema exposed via DTO without `overrideJSONSchema`

**Detection** — a schema bound to a const (or composed into one) uses one of
the unrepresentable Zod constructs:

- **High-signal**: `z.custom(...)`, `z.instanceof(...)`. These always emit
  `{}` to JSON Schema and trip `ZodNestUnrepresentableError` under
  `strict: true`.
- **Medium-signal**: `.transform(...)` _not wrapped by an outer `.pipe()`
  covering it_ — i.e. the transform's output reaches the DTO boundary
  directly. A `z.string().transform(...).pipe(z.number())` is fine because
  the outer `.pipe()` covers it; a bare `.transform()` inside `createZodDto`
  is not.
- **Low-signal (mention conceptually, don't enumerate in normal output)**:
  `z.symbol()`, `z.nan()`, `z.map()`, `z.set()`, `z.undefined()`, `z.void()`.
- **Excluded** — `z.date()` and `z.bigint()` are already handled by the
  engine's `primitiveOverride` (emitted as `string`/`date-time` and
  `integer` respectively). Rule 5 never fires for these.

…AND that schema (or any const wrapping it) flows into a `createZodDto(...)`,
`@ZodResponse(...)`, or `@Body()` / `@Query()` / `@Param()` / `@Headers()`
parameter type, AND there is no `overrideJSONSchema(<schema>, …)` call in
scope for it, AND the schema is not one of the shipped presets (`FileSchema`
/ `BlobSchema` / `BufferSchema` from `zod-nest/helpers`).

**Severity** — depends on the project's `applyZodNest({ strict })` setting
(probe `main.ts` / `bootstrap.ts` once and cache):

- `strict: false` → 🟡. _"Schema emits `{}` to OpenAPI; consumers can't
  introspect the shape."_
- `strict: true` (or unknown — **fallback**):
  - `z.custom` / `z.instanceof` → 🔴. _"Will throw
    `ZodNestUnrepresentableError` at `applyZodNest` time."_
  - `.transform` / lower-signal types → 🟡. _"May throw
    `ZodNestUnrepresentableError` at `applyZodNest` time if not covered by
    an outer pipe."_

**Proposed edit** — show **one** concrete form per case, not a ladder of
variations. Leave enrichment (`contentMediaType`, descriptions, etc.) to the
user.

- **`z.instanceof(File)` / `z.instanceof(Blob)` / `z.instanceof(Buffer)`** →
  suggest the matching preset from `zod-nest/helpers`:

  ```ts
  import { FileSchema } from 'zod-nest/helpers';

  class UploadDto extends createZodDto(z.object({ file: FileSchema })) {}
  ```

- **Other `z.custom<T>()` / `z.instanceof(Other)`** → suggest a bare
  `overrideJSONSchema(<schema>, <fragment>)` call, naming the fragment from
  the catalog that best matches the runtime type (or `binaryFragment` /
  `opaqueFragment` if nothing else fits). Don't fabricate `contentMediaType`
  / `description` values:

  ```ts
  import { overrideJSONSchema } from 'zod-nest';
  import { uuidFragment } from 'zod-nest/helpers';

  const UserIdSchema = overrideJSONSchema(z.custom<UserId>(), uuidFragment);
  ```

- **Bare `.transform(...)`** not covered by an outer pipe → link the
  recipe's I/O divergence section; show the wrapper signature
  `overrideJSONSchema(s, { input, output })` as a template only, with the
  input / output bodies as placeholders for the user to fill in.

The full fragment catalog (`dateTimeFragment`, `uuidFragment`,
`binaryFragment`, `opaqueFragment`, `int64Fragment`, etc.) plus the
`binary(opts?)` / `opaque(opts?)` sugar and the type-strict `enrich(base,
extras)` helper all live at `zod-nest/helpers`.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/recipes/custom-openapi-overrides.md>.

## Out of scope

- **`.refine()` patterns** — schema semantics, not naming or composition.
- **General `.transform()` semantics** — value coercion, defaulting, etc. —
  out of scope. `.transform()` is in scope **only** for Rule 5's
  unrepresentable-emission case (when the transform's output reaches a DTO
  boundary without an outer `.pipe()` covering it).
- **Branded types / `.brand()`** — type-system concern.
- **Per-field validation message customization** — i18n / UX, not ergonomics.
