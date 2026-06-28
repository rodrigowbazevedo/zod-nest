# Composition (`extend` + `getLineage`)

> **`@experimental`** — output shape may change as edge cases surface. Pin a minor version if you build production tooling on top of this surface.

The composition layer lets you derive a Zod object schema from a registered parent and emit an OpenAPI `allOf` body that references the parent by `$ref` and lists only the delta keys inline. The goal is to keep the OpenAPI document DRY when one DTO extends another, without sacrificing Zod's compile-time type tracking.

## The `extend` API

```ts
import { z } from 'zod';
import { extend, getLineage } from 'zod-nest';

const Base = z.object({ id: z.string() }).meta({ id: 'Base' });
const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Child' }));
```

`extend(parent, build)` runs the builder against the parent and records the parent → child lineage. The returned schema is **the schema your builder produced** — `extend` doesn't wrap it, it just registers the link.

The builder receives the parent schema and is expected to return a `z.ZodObject`. The canonical body is `(s) => s.extend({ ... })`, but the builder can do anything — pick/omit, set strict mode, attach refinements — as long as the result is still an object schema with the parent's keys present.

## Apply every schema change inside the builder

The lineage is recorded against the **exact schema instance** the builder returns. Any Zod operator chained on the result of `extend(...)` — `.meta(...)`, `.describe(...)`, `.refine(...)`, `.passthrough()`, `.strict()` — produces a **new** schema instance, which has no lineage entry. The emission silently falls back to a flat body.

```ts
// ✅ Right — `.meta({ id })` is inside the builder.
const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Child' }));

// ❌ Wrong — `.meta({ id })` runs on the return value of `extend(...)`.
//             Watch the closing `)` — it moves left of `.meta(...)`.
const Child = extend(Base, (s) => s.extend({ role: z.string() })).meta({ id: 'Child' });
```

The TypeScript types accept both. The runtime difference is that the wrong form emits `Child` as a flat schema (parent's `id` field inlined) instead of `allOf: [{ $ref: 'Base' }, { delta }]`. `getLineage(Child)` returns `undefined` for the wrong form.

The same applies to every other operator. If you want refinements, descriptions, strict mode, or anything else on the derived schema, chain them inside the builder:

```ts
// ✅ Right — refinements + meta all inside the builder.
const Child = extend(Base, (s) =>
  s
    .extend({ role: z.string() })
    .refine((v) => v.role.length > 0, 'role must be non-empty')
    .meta({ id: 'Child', description: 'An employee.' }),
);

// ❌ Wrong — anything chained after extend() rebuilds the schema and loses lineage.
const Child = extend(Base, (s) => s.extend({ role: z.string() }))
  .refine((v) => v.role.length > 0, 'role must be non-empty')
  .meta({ id: 'Child' });
```

If you only need to register the schema (no additional operators), the builder's return value can be passed through unchanged — just keep the `.meta({ id })` inside:

```ts
const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Child' }));
```

There's no compile-time guard against the wrong form yet. Treat the rule as a snippet/lint discipline: **every schema operator that defines `Child` lives inside `extend(Base, (s) => ...)`**.

## What gets emitted

For a registered parent (one with `.meta({ id })` or registered via `createZodDto`), `Child` emits as:

```json
{
  "type": "object",
  "allOf": [
    { "$ref": "#/components/schemas/Base" },
    {
      "type": "object",
      "properties": { "role": { "type": "string" } },
      "required": ["role"]
    }
  ],
  "unevaluatedProperties": false
}
```

The delta is computed structurally:

- **`type: "object"`** is kept on the outer schema — every `allOf` arm is an object, so the wrapper is unambiguously an object, and the explicit `type` is the more correct / tool-friendly emission (it pairs validly with `allOf`).
- **Properties** that exist on the parent _unchanged_ are stripped from the delta — they're already in the `$ref`. A property the child **overrides** with a different schema (e.g. narrowing an inherited `type: z.enum([...])` to `type: z.literal('A')`) is **kept** in the delta, so the `allOf` intersects the parent's constraint with the child's narrowing instead of silently dropping it.
- **Required** entries that exist on the parent are stripped from the delta's `required` array.
- **`unevaluatedProperties: false`** is set on the outer schema, not on the delta, so the strictness applies to the merged shape.
- **`additionalProperties`** is intentionally omitted from the delta — `unevaluatedProperties` on the outer schema is the correct strictness gate for `allOf` composition.

## Reading the lineage

```ts
import { getLineage } from 'zod-nest';

getLineage(Child);
// → { op: 'extend', parent: Base }

getLineage(Base);
// → undefined (no lineage recorded for a top-level schema)
```

`getLineage(schema)` returns the recorded `LineageEntry` for any schema produced by `extend`, or `undefined` for non-derived schemas. The entry is read-only — mutating it has no effect on emission. Useful when you're building a custom doc generator and need to walk the inheritance graph at the Zod level.

## Anonymous parents

`extend` accepts any `z.ZodObject` as a parent, but the `allOf` emission only fires when the parent has a registered id. If the parent is anonymous:

```ts
const Base = z.object({ id: z.string() }); // no .meta({ id }), not a DTO
const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Child' }));
```

The emission falls back to a flat body — the parent's keys are inlined into `Child` and no `allOf` is produced. This is a feature, not a bug: an anonymous parent can't be `$ref`-ed, so the only correct emission is the flat shape Zod would produce naturally.

If you want the `allOf` behaviour, give the parent an id (`.meta({ id: 'Base' })` or wrap it in `createZodDto(base, { id: 'Base' })`).

A **named** parent (`.meta({ id })`) used only as an `extend()` parent — i.e. never wrapped in `createZodDto` and not referenced from any registered DTO's tree — is registered automatically. `extend()` calls `registerSchema(parent)` for you, so the parent's body lands in `components.schemas` and the child's `$ref` resolves. Earlier versions required an explicit `createZodDto` wrapper to avoid `ZodNestDocumentError: DANGLING_REF` for this pattern.

## Multi-level chains

`extend` records the parent → child link one hop at a time, and the OpenAPI emission threads the chain through transitive `$ref`s:

```ts
const Base = z.object({ id: z.string() }).meta({ id: 'Base' });
const Mid = extend(Base, (s) => s.extend({ name: z.string() }).meta({ id: 'Mid' }));
const Leaf = extend(Mid, (s) => s.extend({ role: z.string() }).meta({ id: 'Leaf' }));
```

The three DTOs emit as three independent `components.schemas` entries:

- `Base` — flat schema with `{ id }`.
- `Mid` — `allOf: [{ $ref: 'Base' }, { name-only delta }]`.
- `Leaf` — `allOf: [{ $ref: 'Mid'  }, { role-only delta }]`.

Swagger UI and JSON Schema validators follow the `$ref` chain transitively, so the effective schema for `Leaf` resolves to the full union of fields from `Base` + `Mid` + `Leaf`. This is how `allOf` composition is designed to work — chained `$ref`s, not a flattened multi-parent list.

`getLineage(schema)` returns the **immediate** parent only. To walk the full ancestry chain (useful in custom doc tooling), call it recursively:

```ts
import { getLineage } from 'zod-nest';

const ancestors = (schema: z.ZodType): readonly z.ZodObject[] => {
  const entry = getLineage(schema);
  if (entry === undefined) {
    return [];
  }
  return [entry.parent, ...ancestors(entry.parent)];
};

ancestors(Leaf); // → [Mid, Base]
```

## What's NOT supported (yet)

- **`.omit(...)` / `.pick(...)` / `.partial(...)`** — derived schemas via these Zod operators don't get lineage recorded. They emit as flat schemas with their own ids.
- **Non-object parents** — `extend` is typed to `z.ZodObject` only.
- **Discriminated-union composition** — if you need `oneOf` with a discriminator, model it as a `z.discriminatedUnion` directly; `extend` doesn't help here.

If any of these blocks you, open an issue with the use case.

## Bulk emission vs single-schema

The composition override runs in both modes (`toOpenApi` for single-schema, `bulkEmit` for `applyZodNest`'s registry pass). The `$ref` path differs:

| Mode                        | Parent `$ref` shape                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Single-schema (`toOpenApi`) | `#/$defs/<parentId>` (then `post-process` rewrites to `#/components/schemas/<parentId>`) |
| Bulk (via `applyZodNest`)   | `#/components/schemas/<parentId>` directly                                               |

This is internal — the OpenAPI document you read always has the final `#/components/schemas/` path. The distinction matters only if you're calling `toOpenApi` directly (e.g. from a custom doc generator).

## Why `@experimental`?

A few specific things may change before this stabilizes:

- The `LineageEntry` shape (currently `{ op: 'extend'; parent: z.ZodObject }`) will grow to cover new operators. `op: 'extend'` is stable; `parent` typing might tighten.
- The emission shape might add `discriminator` annotations when used inside a `z.discriminatedUnion`.
- Anonymous-parent fallback is currently silent — a future release may surface a `console.warn` to make the missing-id case more visible.

None of these breaks the basic API (`extend(parent, build)` + `getLineage(schema)`), but the emitted JSON Schema shape and the `LineageEntry` type may evolve.

## Worked example with `applyZodNest`

```ts
import { z } from 'zod';
import { applyZodNest, createZodDto, extend, ZodResponse } from 'zod-nest';

const personSchema = z
  .object({ id: z.string(), name: z.string() })
  .meta({ id: 'Person', description: 'Common shape for any human reference.' });

const employeeSchema = extend(personSchema, (s) =>
  s
    .extend({ role: z.string(), salary: z.number() })
    .meta({ id: 'Employee', description: 'A person with a job.' }),
);

class PersonDto extends createZodDto(personSchema) {}
class EmployeeDto extends createZodDto(employeeSchema) {}

@Controller('hr')
class HrController {
  @Get('people') @ZodResponse({ type: [PersonDto] }) listPeople() {
    /* ... */
  }
  @Get('employees') @ZodResponse({ type: [EmployeeDto] }) listEmployees() {
    /* ... */
  }
}
```

The resulting `components.schemas` contains:

```json
{
  "Person":   { "type": "object", "properties": { "id": ..., "name": ... }, "required": [...] },
  "Employee": {
    "type": "object",
    "allOf": [
      { "$ref": "#/components/schemas/Person" },
      { "type": "object", "properties": { "role": ..., "salary": ... }, "required": [...] }
    ],
    "unevaluatedProperties": false,
    "description": "A person with a job."
  }
}
```

Swagger UI renders `Employee` as a card that inherits `Person`'s properties via the `$ref` and adds the extension fields. The two DTOs stay independently usable in `@ZodResponse` and `@Body`.
