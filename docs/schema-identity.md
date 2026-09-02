# Schema identity and clones

zod-nest keys some metadata to the **schema instance** you hand it. Zod, meanwhile, returns a **new instance** from most of its builder methods. This page explains which operations clone, which clones keep their zod-nest metadata, and where the boundary sits.

You only need this page when a schema id, an `overrideJSONSchema` fragment, or an `extend` lineage goes missing.

## The two kinds of clone

Zod links a clone to the instance it came from via an internal `parent` pointer, but only for some operations:

| Operation                                                                               | New instance? | Linked to parent? |
| --------------------------------------------------------------------------------------- | ------------- | ----------------- |
| `.meta({ ... })`, `.describe(...)`                                                      | yes           | yes               |
| `z.compile(schema)`                                                                     | yes           | yes               |
| `.refine()`, `.superRefine()`, `.check()`, `.min()`, `.max()`, `.regex()`, `.trim()`, … | yes           | yes               |
| `.extend()`, `.partial()`, `.pick()`, `.omit()`, `.catchall()`                          | yes           | **no**            |
| `.optional()`, `.nullable()`, `.array()`, `.default()`, `.readonly()`                   | yes           | **no**            |

The linked ones split further, and this is the distinction that matters:

- **Annotation clones** — `.meta()`, `.describe()`, `z.compile()` — reuse the parent's definition outright. The emitted JSON Schema body is the parent's.
- **Constraint clones** — everything routed through `.check()`, which includes every `.min()` / `.regex()` / `.refine()` — attach new checks. The emitted body **differs** from the parent's.

## What zod-nest resolves through a clone

**Schema ids resolve through annotation clones.** A named schema keeps its name across `.meta()`, `.describe()` and `z.compile()`:

```ts
const User = z.object({ id: z.string() }).meta({ id: 'User' });

class UserDto extends createZodDto(z.compile(User)) {} // UserDto.id === 'User'
```

The id is registered against `User` — the instance that owns it — not against the clone. The clone emits `$ref: '#/components/schemas/User'`, which is what Zod itself emits for it.

**Ids do not resolve through constraint clones**, because the constraint clone is a different schema:

```ts
const Name = z.string().meta({ id: 'Name' });

class ShortNameDto extends createZodDto(Name.min(3)) {} // id: 'ShortNameDto', NOT 'Name'
```

Adopting `Name` here would emit the component without `minLength: 3`. A constraint clone falls back to the class name, exactly as an unnamed schema does — give it its own `.meta({ id })` when you want a stable component name.

**Document references resolve through every linked clone.** Whichever clone kind you nest, the named ancestor is emitted as a component and the reference resolves:

```ts
const Base = z.object({ a: z.string() }).meta({ id: 'Base' });
const Outer = z.object({ inner: Base.describe('a base') }).meta({ id: 'Outer' });
// Outer.inner -> { $ref: '#/components/schemas/Base', description: 'a base' }
```

> **Nearest wins, no merging.** Resolution stops at the first ancestor that owns what it is looking for. It does not merge partial records from further up the chain — a clone that registers only an `output` fragment does not inherit the ancestor's `input` fragment.

## `overrideJSONSchema` fragments

Fragments resolve through annotation clones, on the same rule as ids — so annotating an overridden schema keeps its fragment:

```ts
const IsoDatetime = overrideJSONSchema(z.iso.datetime(), dateTimeFragment);

z.object({ from: IsoDatetime.describe('Start date') });
// { type: 'string', format: 'date-time', description: 'Start date' }
```

The clone's own `.describe()` wins over the description captured when `overrideJSONSchema` was called. A schema that carries its **own** registration keeps its own fragment and its capture-at-call-time description — inheritance only fills a gap.

They do **not** resolve through constraint clones, for the same reason ids don't — `.refine()` produces a schema whose body is no longer the one the fragment describes:

```ts
// ❌ The fragment stays behind; strict mode throws ZodNestUnrepresentableError.
const Csv = overrideJSONSchema(z.instanceof(Blob), binaryFragment).refine((f) => f.size < 1e6);

// ✅ Register against the final instance.
const Csv = overrideJSONSchema(
  z.instanceof(Blob).refine((f) => f.size < 1e6),
  binaryFragment,
);
```

## What is still keyed to the exact instance

**`extend(parent, builder)` lineage** is keyed strictly to the instance the builder returns, with no resolution through clones — see [`composition.md`](composition.md#apply-every-schema-change-inside-the-builder). Apply every Zod operator inside the builder.

This one stays instance-keyed deliberately: Zod stamps the parent's `$ref` onto a clone before zod-nest's composition override runs, so inheriting the lineage there would emit an `allOf` on top of a `$ref` — a malformed body rather than a loud error.

## `z.compile()`

Zod 4.5 added [`z.compile()`](https://zod.dev/blog/zod-4-5), which pre-compiles a schema for faster parsing. It returns an annotation clone, so ids and document references resolve through it as described above.

**Prefer global mode.** Importing `zod/compile` once at your application entry compiles every schema constructed afterwards, in place, with no new instances at all:

```ts
// main.ts — before any module that constructs schemas
import 'zod/compile';
```

Global mode leaves schema identity untouched, so nothing on this page applies to it. Reach for an explicit `z.compile(schema)` only when you want to compile one schema in isolation.

## See also

- [`dto.md`](dto.md#setting-the-openapi-schema-id) — the full id resolution order
- [`exceptions.md`](exceptions.md) — `DANGLING_REF` and `ZodNestUnrepresentableError`
- [`composition.md`](composition.md) — `extend` / `getLineage`
