# Recipe: Custom OpenAPI emission overrides

For Zod constructs that don't map cleanly to JSON Schema — file uploads (`z.instanceof(File)`), opaque blobs, framework-specific shapes — `zod-nest` offers three escape hatches, in order of ergonomic weight:

1. **Pre-registered schemas** from [`zod-nest/helpers`](#the-zod-nesthelpers-toolkit) — `FileSchema` / `BlobSchema` / `BufferSchema`. Drop into a DTO and you're done.
2. **Per-instance registration** via [`overrideJSONSchema`](#per-instance-registration-with-overridejsonschema) — pair any Zod schema with a fixed JSON Schema fragment (use the helpers' fragment catalog so you don't have to hand-write the magic objects).
3. **Per-call `override` callback** on [`applyZodNest`](#per-call-override-callback) — the global escape hatch that mutates the emitted JSON Schema in place. Use when the gap is per-emission, not per-instance.

## The `zod-nest/helpers` toolkit

A subpath shipping common JSON Schema fragments, typed sugar functions, a type-strict `enrich` for composition, and three pre-registered Zod schemas for binary runtime types. Import what you need:

```ts
import {
  // Fragment catalog (frozen const objects)
  uuidFragment, dateTimeFragment, binaryFragment, opaqueFragment, /* … */
  // Sugar functions
  binary, opaque,
  // Generic, type-strict enrichment
  enrich,
  // Pre-registered Zod schemas
  FileSchema, BlobSchema, BufferSchema,
} from 'zod-nest/helpers';
```

### Fragment catalog

| Fragment | Emits |
| --- | --- |
| `dateTimeFragment` | `{ type: 'string', format: 'date-time' }` |
| `dateFragment` | `{ type: 'string', format: 'date' }` |
| `timeFragment` | `{ type: 'string', format: 'time' }` |
| `uuidFragment` | `{ type: 'string', format: 'uuid' }` |
| `emailFragment` | `{ type: 'string', format: 'email' }` |
| `uriFragment` | `{ type: 'string', format: 'uri' }` |
| `hostnameFragment` | `{ type: 'string', format: 'hostname' }` |
| `ipv4Fragment` / `ipv6Fragment` | `{ type: 'string', format: 'ipv4' / 'ipv6' }` |
| `binaryFragment` | `{ type: 'string', format: 'binary' }` |
| `byteFragment` | `{ type: 'string', format: 'byte' }` (base64) |
| `int32Fragment` / `int64Fragment` | `{ type: 'integer', format: 'int32' / 'int64' }` |
| `floatFragment` / `doubleFragment` | `{ type: 'number', format: 'float' / 'double' }` |
| `opaqueFragment` | `{ type: 'object', additionalProperties: true }` |

Many of these mirror what Zod constructs already emit (`z.uuid()` → `uuidFragment` shape, `z.email()` → `emailFragment` shape, etc.). The helpers don't *replace* those constructs — they're a parallel catalog for programmatic fragment assembly: alongside `z.custom<T>()`, in `overrideJSONSchema` calls, in custom override callbacks, in tests that build expected fragments.

### Type-strict `enrich`

`enrich(base, extras)` merges a catalog fragment with extras whose shape is dictated by the base's family. Passing wrong-family extras is a compile-time error.

```ts
enrich(uuidFragment, { description: 'User id', minLength: 36 });    // ok
enrich(binaryFragment, { contentMediaType: 'application/pdf' });    // ok
enrich(int64Fragment, { minimum: 0, multipleOf: 100 });             // ok
enrich(uuidFragment, { contentMediaType: 'application/pdf' });      // TS error
enrich(int32Fragment, { minLength: 1 });                            // TS error
```

### Sugar functions

`binary()` and `opaque()` are typed wrappers over `enrich(binaryFragment, …)` / `enrich(opaqueFragment, …)`. They exist because the `binary` option set (`contentMediaType` / `contentEncoding`) is nuanced enough to deserve a dedicated entry point, discoverable via auto-complete:

```ts
binary();                                              // { type: 'string', format: 'binary' }
binary({ contentMediaType: 'application/pdf' });       // … + contentMediaType
opaque({ description: 'JWT passthrough' });            // { type: 'object', additionalProperties: true, description: '…' }
```

### Pre-registered Zod schemas

`FileSchema`, `BlobSchema`, and `BufferSchema` are ready-to-use Zod schemas already wired through `overrideJSONSchema` to emit `binaryFragment`. Drop them directly into a DTO:

```ts
import { z } from 'zod';
import { createZodDto } from 'zod-nest';
import { FileSchema } from 'zod-nest/helpers';

class UploadDto extends createZodDto(
  z.object({ title: z.string(), file: FileSchema }),
) {}
```

Each preset uses `z.instanceof(...)` at the runtime layer — `File`, `Blob`, `Buffer` are all globals under zod-nest's Node 22+ floor.

## File uploads

NestJS' `@nestjs/platform-express` exposes uploaded files as `Express.Multer.File`. The easiest path: use `FileSchema` (or `BlobSchema` / `BufferSchema`) from the helpers subpath.

```ts
import { z } from 'zod';
import { createZodDto } from 'zod-nest';
import { FileSchema } from 'zod-nest/helpers';

class UploadDto extends createZodDto(
  z.object({ title: z.string(), file: FileSchema }),
) {}
```

If you need a tighter content-type description, register your own schema with `binary({...})`:

```ts
import { createZodDto, overrideJSONSchema } from 'zod-nest';
import { binary } from 'zod-nest/helpers';

const PdfUploadSchema = overrideJSONSchema(
  z.instanceof(File),
  binary({ contentMediaType: 'application/pdf' }),
);

class PdfUploadDto extends createZodDto(
  z.object({ title: z.string(), file: PdfUploadSchema }),
) {}
```

## Per-instance registration with `overrideJSONSchema`

When the shipped presets don't fit — a runtime type other than `File`/`Blob`/`Buffer`, a branded `z.custom<T>()`, an `z.unknown()` you want documented but not introspected — register a JSON Schema fragment against the schema instance:

```ts
import { z } from 'zod';
import { createZodDto, overrideJSONSchema } from 'zod-nest';
import { uuidFragment, binaryFragment, opaque } from 'zod-nest/helpers';

// Branded id type emitted as a UUID string
type UserId = string & { readonly __brand: 'UserId' };
const UserIdSchema = overrideJSONSchema(z.custom<UserId>(), uuidFragment);

// Inline composition — overrideJSONSchema returns the schema, so it chains
class ProfileDto extends createZodDto(
  z.object({ userId: UserIdSchema, name: z.string() }),
) {}

// Opaque passthrough payload
const PayloadSchema = overrideJSONSchema(z.unknown(), opaque({ description: 'JWT' }));
```

Every emission of a registered schema — direct or nested — writes the registered fragment verbatim. No `override` callback on `applyZodNest`, no `@ApiBody({...})` workaround.

For the symmetric case on the response side (binary downloads / streaming exports), see [`binary-downloads.md`](binary-downloads.md) — same `overrideJSONSchema` pattern, paired with `@ZodResponse` instead of `@Body`.

**Precedence.** Per-call `override` (passed to `applyZodNest` / `toOpenApi`) still wins over a registration — registrations sit between `compositionOverride` and the caller's `override` in the chain. The intuitive ladder:

1. `primitiveOverride` (built-in `bigint` / `date` mappings)
2. `compositionOverride` (`extend()`-derived → `allOf`)
3. **`overrideJSONSchema` registration** (per-instance map lookup)
4. Caller's per-call `override` (per-emission escape hatch)

**Idempotent.** Subsequent `overrideJSONSchema(sameInstance, newFragment)` calls overwrite the prior registration (last-write-wins). The registration is keyed by schema *identity* — two separate `z.instanceof(File)` calls produce two separate schemas and would each need their own registration. If you want the same fragment everywhere, share the schema instance (or use the shipped preset).

**Memory.** The registration map is a `WeakMap` keyed by schema identity — when your schema instance goes out of scope, the registration is collected with it.

### Diverging input vs output fragments

Some schemas describe **different shapes** on the request side vs the response side — typical for coercion helpers, where the input is permissive (accepts many shapes) but the output is normalized. A single fragment can't express that. The wrapper form lets you register both sides separately:

```ts
overrideJSONSchema(coercedSchema, {
  input:  { type: 'string', description: 'permissive — request side' },
  output: { type: 'string', description: 'normalized — response side' },
});
```

The engine picks `input` during request-body emission and `output` during response-body / serializer emission. Omit a side to leave Zod's default emission untouched for that direction:

```ts
overrideJSONSchema(s, { output: { type: 'string' } });
// Input side still emits whatever Zod would emit by default.
```

The discriminator between the single-fragment form and the wrapper form is the presence of an `input` or `output` key. Neither is a JSON Schema / OpenAPI 3.1 keyword, so the two forms never collide in practice.

**Real-world pattern: `singleOrArray` coercion.** A helper that accepts `T | T[]` on input but always normalizes to `T[]` on output:

```ts
import { z } from 'zod';
import { overrideJSONSchema, type SchemaObject } from 'zod-nest';

const singleOrArray = <T extends z.ZodType>(item: T) => {
  const itemFrag: SchemaObject = { type: 'string' };  // example: T = string
  const arrFrag: SchemaObject = { type: 'array', items: itemFrag };

  const pipe = item.transform((v) => [v]);
  overrideJSONSchema(pipe, { input: itemFrag, output: arrFrag });

  return z.union([z.array(item), pipe]);
};
```

A single registration on the outer pipe is enough — the engine suppresses the inner transform's strict-mode hit when the outer pipe covers the relevant io side, so you do not have to reach into `_zod.def.out` to silence it.

Input emission: `{ anyOf: [arrFrag, itemFrag] }` (item or array).
Output emission: `{ anyOf: [arrFrag, arrFrag] }` (always array).

## Opaque blobs

When a field carries a value your API doesn't introspect (a passthrough JWT, a base64-encoded payload, an upstream-controlled shape), use `opaqueFragment` or the `opaque()` sugar:

```ts
import { z } from 'zod';
import { createZodDto, overrideJSONSchema } from 'zod-nest';
import { opaque } from 'zod-nest/helpers';

const PayloadSchema = overrideJSONSchema(
  z.unknown(),
  opaque({ description: 'Opaque payload — shape not validated by this API.' }),
);

class MessageDto extends createZodDto(
  z.object({ id: z.string(), payload: PayloadSchema }),
) {}
```

`z.unknown()` is already permissive at runtime — the override only changes how Swagger UI describes it.

## Date constructs

`z.date()` is **already handled** by `primitiveOverride` — it emits as `{ type: 'string', format: 'date-time' }` without any registration. You only need an override when you want to *deviate* from that default (e.g. emit as a unix timestamp number). For most apps, prefer `z.iso.datetime()` over `z.date()` — it round-trips correctly through JSON.

If you do want a custom `Date` representation:

```ts
import { overrideJSONSchema } from 'zod-nest';

const UnixTimestampSchema = overrideJSONSchema(z.date(), {
  type: 'integer',
  format: 'int64',
  description: 'Milliseconds since epoch',
});
```

## Big integers

Same story as dates — `z.bigint()` is already handled by `primitiveOverride` (emits as `{ type: 'integer' }`). Override only if you want a different representation (e.g. string-encoded to preserve precision across JSON):

```ts
const BigIntStringSchema = overrideJSONSchema(z.bigint(), {
  type: 'string',
  pattern: '^-?\\d+$',
  description: 'Arbitrary-precision integer, serialized as string.',
});
```

This assumes you've wired a `JSON.stringify` replacer to encode `bigint` as a string at the response boundary — the override only describes the wire format; the actual serialization is on you.

## Per-call `override` callback

When the gap is per-emission rather than per-instance — e.g. you want to mutate every `z.custom(...)` emission across the document — pass an `override` to `applyZodNest`:

```ts
import type { Override } from 'zod-nest';

const myOverride: Override = (ctx) => {
  const type = ctx.zodSchema._zod.def.type;
  switch (type) {
    case 'custom':
      ctx.jsonSchema.type = 'string';
      ctx.jsonSchema.format = 'binary';
      delete ctx.jsonSchema.properties;
      break;

    // primitiveOverride already handles 'date' and 'bigint'; override only if
    // you want to deviate from those defaults.
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
