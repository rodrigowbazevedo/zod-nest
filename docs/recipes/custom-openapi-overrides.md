# Recipe: Custom OpenAPI emission overrides

For Zod constructs that don't map cleanly to JSON Schema — file uploads (`z.instanceof(Buffer)`), opaque blobs, framework-specific shapes — pass an `override` callback to `applyZodNest`. The callback runs on top of the built-in chain (composition `allOf`, primitive overrides) and can mutate the emitted JSON Schema in place.

## File uploads

NestJS' `@nestjs/platform-express` exposes uploaded files as `Express.Multer.File`. Model the field with `z.instanceof(...)` and emit it as an OpenAPI `binary` string:

```ts
import { z } from 'zod';
import { applyZodNest, createZodDto, ZodResponse } from 'zod-nest';

const uploadSchema = z
  .object({
    title: z.string(),
    file: z.instanceof(Object).meta({ id: 'UploadedFile' }),
  })
  .meta({ id: 'Upload' });

class UploadDto extends createZodDto(uploadSchema) {}

// In main.ts:
const doc = applyZodNest(raw, {
  app,
  override: (ctx) => {
    if (ctx.zodSchema._zod.def.type === 'custom') {
      ctx.jsonSchema.type = 'string';
      ctx.jsonSchema.format = 'binary';
      delete ctx.jsonSchema.properties;
      delete ctx.jsonSchema.required;
    }
  },
});
```

The override fires for every `z.instanceof(...)` / `z.custom(...)` construct. Branch on the schema metadata if you want to handle specific custom types differently.

## Opaque blobs

When a field carries a value your API doesn't introspect (a passthrough JWT, a base64-encoded payload, an upstream-controlled shape), emit it as an opaque JSON Schema object so consumers know it exists but don't try to validate its shape:

```ts
const messageSchema = z
  .object({
    id: z.string(),
    payload: z.unknown().meta({ id: 'OpaquePayload' }),
  })
  .meta({ id: 'Message' });

// In applyZodNest:
override: (ctx) => {
  if (ctx.zodSchema._zod.def.type === 'unknown') {
    ctx.jsonSchema.type = 'object';
    ctx.jsonSchema.description = 'Opaque payload — shape not validated by this API.';
    ctx.jsonSchema.additionalProperties = true;
  }
};
```

`z.unknown()` is already permissive at runtime — the override only changes how Swagger UI describes it.

## Date constructs

`z.date()` isn't representable as JSON Schema by default (strict mode throws `ZodNestUnrepresentableError`). Emit it as ISO-8601 instead:

```ts
override: (ctx) => {
  if (ctx.zodSchema._zod.def.type === 'date') {
    ctx.jsonSchema.type = 'string';
    ctx.jsonSchema.format = 'date-time';
  }
};
```

For most apps, prefer `z.iso.datetime()` over `z.date()` — it round-trips correctly through JSON without needing an override. Save the override for cases where you genuinely have a `Date` instance at the runtime boundary (e.g. from a database client returning native `Date` objects).

## Big integers

Same pattern for `z.bigint()`:

```ts
override: (ctx) => {
  if (ctx.zodSchema._zod.def.type === 'bigint') {
    ctx.jsonSchema.type = 'string';
    ctx.jsonSchema.pattern = '^-?\\d+$';
    ctx.jsonSchema.description = 'Arbitrary-precision integer, serialized as string.';
  }
};
```

This assumes you've already wired a `JSON.stringify` replacer to encode `bigint` as a string at the response boundary — the override only describes the wire format; the actual serialization is on you.

## Composing multiple overrides

The `override` argument accepts a single function. If you need to chain logic for several constructs, write one callback that switches:

```ts
const myOverride: Override = (ctx) => {
  const type = ctx.zodSchema._zod.def.type;
  switch (type) {
    case 'custom':
      ctx.jsonSchema.type = 'string';
      ctx.jsonSchema.format = 'binary';
      delete ctx.jsonSchema.properties;
      break;

    case 'date':
      ctx.jsonSchema.type = 'string';
      ctx.jsonSchema.format = 'date-time';
      break;

    case 'bigint':
      ctx.jsonSchema.type = 'string';
      ctx.jsonSchema.pattern = '^-?\\d+$';
      break;
  }
};

const doc = applyZodNest(raw, { app, override: myOverride });
```

Built-in overrides (composition, primitive types) run **before** your callback, so by the time your code runs the `jsonSchema` is in its post-built-in state. Mutate in place — `ctx.jsonSchema = newBody` doesn't propagate; only modifications to the existing object reference reach the caller.

## When to use `strict: false` instead

For prototypes or internal-only docs where you don't care about emitting a precise schema, `strict: false` is simpler than writing overrides:

```ts
applyZodNest(raw, { app, strict: false });
```

Unrepresentable constructs emit as `{}` (any value allowed). The spec is still valid; consumers just learn nothing about those fields. Useful as a stop-gap before you decide on the right override shape.

See [`docs/swagger-integration.md → override callback`](../swagger-integration.md#override-callback) for the type signature and the relationship to the built-in override chain.
