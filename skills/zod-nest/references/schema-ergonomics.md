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
object literal has **more than 2 fields**, *or* is the same shape as one in
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

## Out of scope

- **`.refine()` / `.transform()` patterns** — schema semantics, not naming or
  composition.
- **Branded types / `.brand()`** — type-system concern.
- **Per-field validation message customization** — i18n / UX, not ergonomics.
