# DTOs (`createZodDto`)

`createZodDto(schema, options?)` returns a class that wraps one Zod schema. The class is what NestJS' introspection (parameter metatype, `@nestjs/swagger`) sees; the validation and the OpenAPI emission both come from the schema directly.

```ts
import { z } from 'zod';
import { createZodDto } from 'zod-nest';

const userSchema = z.object({ id: z.uuid(), name: z.string() }).meta({ id: 'User' });
class UserDto extends createZodDto(userSchema) {}
```

## What the class carries

| Static member      | Type                                            | Notes                                                                           |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `schema`           | `TSchema`                                       | The original Zod schema, untouched.                                             |
| `id`               | `string`                                        | OpenAPI schema name. Resolved lazily on first read.                             |
| `io`               | `'input' \| 'output'`                           | Always `'input'` on the parent class. The `.Output` sibling carries `'output'`. |
| `Output`           | `ZodDto<TSchema>`                               | Lazy sibling class for output-side emission. See [I/O sibling](#io-sibling).    |
| `parse(input)`     | `(input: unknown) => z.infer<TSchema>`          | `schema.parse(input)` — throws Zod's native error on failure.                   |
| `safeParse(input)` | `(input: unknown) => z.ZodSafeParseResult<...>` | `schema.safeParse(input)` — never throws.                                       |

The class is tagged with `Symbol.for('zod-nest.dto')`, which `ZodValidationPipe`, `ZodSerializerInterceptor`, and `applyZodNest` use to discriminate it from plain constructors.

## Setting the OpenAPI schema id

Two equivalent forms — pick the one that fits the call site:

```ts
// Preferred — id on the schema via Zod's metadata.
const userSchema = z
  .object({
    /* ... */
  })
  .meta({ id: 'User' });
class UserDto extends createZodDto(userSchema) {}

// Also valid — id as createZodDto's second argument.
class UserDto extends createZodDto(
  z.object({
    /* ... */
  }),
  { id: 'User' },
) {}
```

Resolution order, applied lazily on the first read of `Dto.id`:

1. `options.id` from the second argument, if set.
2. `schema.meta({ id })` read from the registry.
3. The class name (`UserDto`, `WidgetDto`, …).
4. A generated `_AnonZodDto_<n>` with a one-time `console.warn`.

Step 4 is the minification trap — class names become single-character identifiers and collide. Set an explicit id either way for production builds. The warning fires at most once per process.

**When `options.id` and `schema.meta.id` both exist, `options.id` wins.** This is by design: a caller passing an explicit id is making a deliberate per-DTO override decision.

### Registering without `createZodDto`

`registerSchema(schema, registry?, options?)` is the standalone version of steps 1–2 above — it resolves a schema's id from `options.id` (if provided) then `.meta({ id })`, and registers it with the given registry (defaults to `defaultRegistry`). `createZodDto` itself routes through this helper.

```ts
import { registerSchema } from 'zod-nest';

const Fieldset = z.object({ id: z.string(), label: z.string() }).meta({ id: 'Fieldset' });
registerSchema(Fieldset); // → 'Fieldset', registered in defaultRegistry
```

Returns the resolved id, or `undefined` when the schema has no `.meta({ id })` and no `options.id` was given. Idempotent.

Most callers won't need this directly — `createZodDto` is the usual entry point, and `extend()` registers its parent + result automatically since 1.6. Reach for `registerSchema` when you have a named schema that doesn't fit either path (e.g. a non-extend sub-schema you want emitted into `components.schemas` for reference from a third-party doc generator).

## Schema metadata for Swagger UI

`.meta({ ... })` isn't just for `id`. Any standard JSON Schema annotation you attach to the schema flows through `z.toJSONSchema` into the OpenAPI document, and Swagger UI renders them in the interactive view:

```ts
const userSchema = z
  .object({
    id: z.uuid().meta({
      description: 'Stable, opaque user identifier.',
      examples: ['00000000-0000-0000-0000-000000000000'],
    }),
    email: z.email().meta({ description: 'Lower-cased on output.' }),
  })
  .meta({
    id: 'User',
    title: 'User',
    description: 'A registered user. Returned from `/users/:id` and accepted by `POST /users`.',
  });

class UserDto extends createZodDto(userSchema) {}
```

The fields you'll most often reach for:

| Field         | Where it shows up                                                                        |
| ------------- | ---------------------------------------------------------------------------------------- |
| `title`       | Schema heading in Swagger UI (above the property table)                                  |
| `description` | Schema-level description block. On a field schema, the field's description column.       |
| `examples`    | Pre-filled value in the "Try it out" panel; rendered as an `examples` array in the spec. |
| `deprecated`  | Strike-through styling + a "Deprecated" badge in Swagger UI.                             |

Attach `.meta()` at any nesting depth — schema-level annotations (the outermost `.meta()`) describe the type as a whole; field-level `.meta()` annotations describe individual properties. The two compose without conflict.

For the full set of recognized keys, see the Zod v4 [`.meta()` reference](https://zod.dev/api/meta) — anything Zod passes through to JSON Schema becomes a Swagger UI affordance.

## I/O sibling

`UserDto.Output` returns a distinct sibling class that carries `io: 'output'`. The sibling is cached per parent (via a `WeakMap`) so repeated reads return the same instance — `Dto.Output === Dto.Output` and `Dto.Output.Output === Dto.Output` (idempotent).

Why a separate class? Because `applyZodNest` needs to emit the output-side JSON Schema and apply the suffix truth table — that decision lives at doc-build time, not at DTO-construction time. The sibling exposes the same `schema` / `parse` / `safeParse` surface; only `io` differs.

You rarely need `.Output` directly — `@ZodResponse({ type: UserDto })` resolves to the right side internally. Reach for it when you're building a custom interceptor or a custom OpenAPI emitter and need the output-side metadata explicitly.

## I/O suffix truth table

`applyZodNest` compares the emitted input and output JSON Schemas for each DTO and decides whether to emit one or two `components.schemas` entries:

| Schema shape                                                                   | OpenAPI emission                       |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| `z.object({ id: z.string() })` (no I/O divergence)                             | `User` only                            |
| `z.object({ email: z.email().transform((v) => v.toLowerCase()) })` (transform) | `User` (input) + `UserOutput` (output) |
| `z.object({ x: z.string().optional().default('y') })` (default)                | `User` (input) + `UserOutput` (output) |
| `z.object({ /* identical input + output */ }).meta({ id })`                    | `User` only                            |

The split is **per byte-equality of the emitted body**, not per Zod type. `z.string().transform(x => x)` produces a schema whose input and output JSON Schemas are byte-equal — it does not split. Only divergent emissions split.

Response refs are rewritten to `<Id>Output` automatically when the split fires; request-body refs always point at `<Id>`.

## Codec mode

`nestjs-zod` had a `{ codec: true }` flag. `zod-nest` doesn't. Express the codec in the schema itself with `z.pipe` or `z.transform`:

```ts
const dateSchema = z.iso
  .date() // input: 'YYYY-MM-DD' string
  .transform((s) => new Date(s)) // runtime: Date instance
  .meta({ id: 'IsoDate' });

class IsoDateDto extends createZodDto(dateSchema) {}
```

This produces a split — input `string (date)`, output `string (date-time)` (or whatever Zod emits for the runtime type). The decision lives in the schema, not in a DTO-construction flag.

## Custom registry

```ts
import { createRegistry, createZodDto } from 'zod-nest';

const registry = createRegistry();
class UserDto extends createZodDto(userSchema, { registry }) {}
```

DTOs default to `defaultRegistry` (the process-wide singleton). Pass a custom registry to isolate two NestJS apps in the same process, or to keep test fixtures from leaking into the production registry.

Multi-app isolation via `WeakMap` keyed on the app instance isn't built in yet — pass an explicit registry per app for now.

## Runtime guards

`isZodDto(value)` returns `true` if `value` is a class returned by `createZodDto`. It's the same predicate the pipe and interceptor use:

```ts
import { isZodDto } from 'zod-nest';

if (isZodDto(metatype)) {
  // metatype is now typed as ZodDto
}
```

Useful inside custom pipes, interceptors, or exception filters that need to special-case zod-nest DTOs.

## Class semantics

A `createZodDto` class is a real class. `instanceof` works, you can extend it, and TypeScript sees it as both a class and a `ZodDto<TSchema>` interface:

```ts
import type { ZodDto } from 'zod-nest';

const asInterface: ZodDto<typeof userSchema> = UserDto;
```

The class body has no instance methods of its own — all functionality is on static members. Instantiating the class (`new UserDto()`) is legal but doesn't do anything useful; the type system exposes the inferred shape (`InstanceType<typeof UserDto>` = `z.infer<typeof userSchema>`) for typing the validated value in handlers, not for runtime construction.
