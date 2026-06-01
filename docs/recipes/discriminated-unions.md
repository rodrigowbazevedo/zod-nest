# Recipe: Discriminated unions

For sum types where each branch has a distinguishing literal field — `z.discriminatedUnion` carries the discriminator through to OpenAPI as `oneOf` + a `discriminator` annotation. The result is a Swagger UI panel that shows each branch as a separate variant with the discriminator pre-selected.

## The basic shape

```ts
import { z } from 'zod';

const successSchema = z
  .object({
    kind: z.literal('success'),
    data: z.object({ id: z.string() }),
  })
  .meta({ id: 'SuccessEvent' });

const failureSchema = z
  .object({
    kind: z.literal('failure'),
    error: z.object({ code: z.number(), message: z.string() }),
  })
  .meta({ id: 'FailureEvent' });

const eventSchema = z
  .discriminatedUnion('kind', [successSchema, failureSchema])
  .meta({ id: 'Event' });
```

Note there's **no `createZodDto(eventSchema)`** — a discriminated union's `z.infer<>` is a TS union, which can't be a class base (`class … extends createZodDto(eventSchema)` fails with TS2509). Use the schema directly: a raw schema in `@ZodResponse` for responses (below), or `@ZodBody` + `ZodValidationPipe` for request bodies (see [intersection-with-union.md](./intersection-with-union.md)).

## OpenAPI emission

```json
{
  "components": {
    "schemas": {
      "SuccessEvent": { "type": "object", "properties": { "kind": { "const": "success" }, ... } },
      "FailureEvent": { "type": "object", "properties": { "kind": { "const": "failure" }, ... } },
      "Event": {
        "oneOf": [
          { "$ref": "#/components/schemas/SuccessEvent" },
          { "$ref": "#/components/schemas/FailureEvent" }
        ],
        "discriminator": {
          "propertyName": "kind",
          "mapping": {
            "success": "#/components/schemas/SuccessEvent",
            "failure": "#/components/schemas/FailureEvent"
          }
        }
      }
    }
  }
}
```

Swagger UI renders this as a dropdown that picks one branch at a time. Each branch has its own example field, its own required list, and its own description.

## Why a discriminator helps

Without the discriminator, the spec is just `oneOf` — a generic OpenAPI client knows the response is one of N shapes but can't tell which without trying each. With the discriminator:

- Code generators (TypeScript, Rust, Go) produce proper tagged unions.
- Swagger UI shows a working "Try it out" form per branch.
- Validation tools can fail fast on the discriminator field instead of trying every branch.

`z.discriminatedUnion('kind', [...])` enforces the discriminator at runtime — Zod uses the discriminator value to pick the branch immediately instead of trying each schema. The OpenAPI emission mirrors that.

## With `@ZodResponse`

Pass the union schema directly as the response type — `@ZodResponse` normalises it to an output DTO internally, so there's no class to extend and no TS2509:

```ts
@Controller('events')
class EventsController {
  @Get('latest')
  @ZodResponse({ type: eventSchema })
  latest(): z.infer<typeof eventSchema> {
    return { kind: 'success', data: { id: 'e1' } };
  }
}
```

The interceptor validates the response against the full `discriminatedUnion`. If `kind` is `'success'` but `data` is missing, you get a validation failure (logged + 500 in strict mode, soft passthrough if you opt in).

## Mixing constants and runtime data

Each branch is a full schema — feel free to mix constant literals with computed fields:

```ts
const queuedJobSchema = z
  .object({
    status: z.literal('queued'),
    queuePosition: z.number().int().nonnegative(),
  })
  .meta({ id: 'QueuedJob' });

const runningJobSchema = z
  .object({
    status: z.literal('running'),
    startedAt: z.iso.datetime(),
    progress: z.number().min(0).max(1),
  })
  .meta({ id: 'RunningJob' });

const completedJobSchema = z
  .object({
    status: z.literal('completed'),
    result: z.unknown(),
    completedAt: z.iso.datetime(),
  })
  .meta({ id: 'CompletedJob' });

const jobSchema = z
  .discriminatedUnion('status', [queuedJobSchema, runningJobSchema, completedJobSchema])
  .meta({ id: 'Job' });
```

The three branches have entirely different field sets. The discriminator (`status`) is the only shared key. This is the pattern OpenAPI's `oneOf` + `discriminator` is designed for.

## What doesn't work

- **String unions as discriminators** — `z.union([z.string(), z.number()])` isn't a discriminated union; use `z.discriminatedUnion('field', [branchA, branchB])` so the discriminator is structural.
- **Discriminator field as a wildcard** — the discriminator must be a literal in every branch (`z.literal('foo')`, not `z.string()`). A non-literal discriminator falls back to `oneOf` without the `discriminator` annotation.
- **Nested discriminators** — only the top-level union gets a discriminator. If a branch is itself a `z.discriminatedUnion`, the inner discriminator emits but Swagger UI's renderer is shallow about following them.

For non-discriminated sums, `z.union(...)` emits as plain `oneOf` and works fine — you just lose the convenience of the `discriminator` annotation.

See [`docs/swagger-integration.md`](../swagger-integration.md) for the doc-build pipeline.
