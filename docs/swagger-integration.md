# Swagger integration (`applyZodNest`)

`applyZodNest(rawDoc, options)` is the single post-processor that runs after `SwaggerModule.createDocument(...)`. It walks the doc, replaces every `x-zod-nest-dto` marker with the real Zod-derived JSON Schema, applies the I/O suffix truth table, strips the markers, validates the ref graph, and returns the same (mutated) document for compositional convenience.

```ts
import { applyZodNest } from 'zod-nest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const raw = SwaggerModule.createDocument(
  app,
  new DocumentBuilder().setTitle('Users').setVersion('1').build(),
);
const doc = applyZodNest(raw, { app });
SwaggerModule.setup('docs', app, doc);
```

One call replaces the entire `cleanupOpenApiDoc` ritual that earlier libraries needed. No 3.0 fallback — the output is always OpenAPI 3.1.

## Options

```ts
interface ApplyZodNestOptions {
  app: INestApplication;
  registry?: ZodNestRegistry;
  override?: Override;
  strict?: boolean;
}
```

| Option | Required | Default | What it does |
|---|---|---|---|
| `app` | yes | — | The NestJS app instance. Used to walk controllers via `DiscoveryService` to pick up `@ZodResponse` output-side DTO usage. |
| `registry` | no | `defaultRegistry` | Pass an explicit registry for multi-app isolation. |
| `override` | no | `undefined` | User-supplied emission override applied on top of the built-in overrides (composition, primitives). |
| `strict` | no | `true` | Strict mode throws `ZodNestUnrepresentableError` on unrepresentable Zod constructs (bigint / date / symbol / transform / …). |

**Why `app` is required.** `@nestjs/swagger` is anemic on response shapes — it materializes `requestBody` and `parameters` `$ref`s back to `components.schemas`, but response types live on controller-method metadata that the raw doc doesn't surface. `applyZodNest` uses `DiscoveryService` to walk the controller graph and pick up `@ZodResponse` output-side DTO usage.

## The post-processing pipeline

`applyZodNest` runs these passes in order, mutating the doc as it goes:

1. **Collect usage.** Walk the input-side `$ref`s in the doc (reliable — `@nestjs/swagger` materializes them) and the output-side `@ZodResponse` metadata on every controller method. Produces `{ inputExposedIds, outputExposedIds }`.
2. **Bulk emit.** Run `z.toJSONSchema` against the registry once per side (`input`, `output`), producing two maps `Record<dtoId, SchemaObject>`. Filtered to the ids `zod-nest` itself registered — third-party entries in `z.globalRegistry` are left alone.
3. **Merge schemas.** For each id, apply the I/O suffix truth table. Equal bodies collapse to `components.schemas[id]`. Divergent bodies split as `id` (input) + `<id>Output` (output). Class-name → dtoId rename pass runs alongside.
4. **Rewrite refs.** Two sub-passes: (a) class-name → dtoId rename for every `$ref` in the doc; (b) response-side `$ref` rewrite to `<id>Output` for every id in `divergentOutputIds`. Scoped to `paths.*.{op}.responses.*` so request-side refs are untouched.
5. **Strip markers.** Remove every `x-zod-nest-dto` placeholder from `components.schemas[*].properties`. Empty `properties` blocks are dropped. The `x-zod-nest-error` extension (engine collision policy) is preserved so the broken contract stays visible in Swagger UI.
6. **Assert no dangling refs.** Walk every `$ref` and confirm the target exists in `components.schemas`. Throws `ZodNestDocumentError({ code: 'DANGLING_REF' })` on the first miss, listing every offending ref with a per-ref hint inferred from collected usage.

The function is **composable** — apply your own doc-transform passes before or after `applyZodNest`. Just ensure that any pre-pass that touches `$ref`s knows what's coming.

## Schema metadata flows through

The bulk-emit pass calls `z.toJSONSchema`, so any standard JSON Schema annotation you attach via Zod's `.meta({ ... })` lands in the OpenAPI document and Swagger UI renders it — `title`, `description`, `examples`, `deprecated`, etc. Schema-level and field-level annotations both flow through, at any nesting depth:

```ts
const userSchema = z
  .object({
    id: z.uuid().meta({ description: 'Stable, opaque user identifier.' }),
  })
  .meta({ id: 'User', title: 'User', description: 'A registered user.' });
```

See [`dto.md → Schema metadata for Swagger UI`](dto.md#schema-metadata-for-swagger-ui) for the full list of recognized keys and where each shows up in the Swagger UI panes.

## Doc-build errors

```ts
class ZodNestDocumentError extends ZodNestError {
  readonly code: 'AMBIGUOUS_RENAME' | 'DANGLING_REF';
  readonly details: Readonly<Record<string, unknown>>;
}
```

### `AMBIGUOUS_RENAME`

Two distinct DTO classes target the same registry id with differing bodies. The rename pass can't write `components.schemas[id]` unambiguously — which body wins?

Typical cause: copy-pasted `createZodDto(otherSchema, { id: 'User' })` somewhere, or two `.meta({ id: 'User' })` calls on different schemas. Fix by giving each schema a unique id.

### `DANGLING_REF`

A `$ref` in the doc points at a `components.schemas` key that no longer exists after `applyZodNest`. Usually means:
- A marker was stripped but its rename target wasn't populated — typically a registry mismatch where the DTO is referenced via `@Body() body: UserDto` but `UserDto` wasn't registered to the right `ZodNestRegistry`.
- A user-supplied pre-pass left a stale ref behind.
- A `.meta({ id })` typo — the schema is registered under `User`, but the consumer refers to `Users`.

The error message lists every offending ref with a hint from the collected-usage table: was the id seen on input only, output only, both, or unknown? "Unknown" usually means a missing `.meta({ id })` or unregistered DTO.

## `strict` mode

`strict: true` (default) — emission throws `ZodNestUnrepresentableError` for Zod constructs that JSON Schema can't represent:

- `z.bigint()`
- `z.date()`
- `z.symbol()`
- `z.transform(...)` (the function form, not the schema-level transform)
- `z.custom(...)`
- `z.never()`
- `z.function(...)`

Mitigation — three options, most-targeted first:

1. **`overrideJSONSchema(schema, fragment)`** — register a fixed JSON Schema fragment for a specific schema *instance*. Best for `z.custom` / `z.instanceof` (e.g. multipart `File` fields). See [`recipes/custom-openapi-overrides.md`](recipes/custom-openapi-overrides.md#per-instance-registration-with-overridejsonschema).
2. **`override` callback** — per-call hook that fires for every schema of a matching Zod type. Useful when one rule should cover all `z.bigint()` / all `z.date()`. See [`override` callback](#override-callback) below.
3. **`strict: false`** — globally relax the check; unrepresentable constructs emit as empty schemas. The spec validates, but the OpenAPI contract loses information. Use this when you have a small number of unrepresentable constructs you intentionally want to model as opaque.

## `override` callback

`Override` is the same callback shape Zod uses for `z.toJSONSchema(..., { override })`:

```ts
type Override = (ctx: OverrideContext) => void;
interface OverrideContext {
  zodSchema: z.ZodType;
  jsonSchema: SchemaObject;
}
```

Apply user-defined emission tweaks here. Common cases:

```ts
applyZodNest(raw, {
  app,
  override: (ctx) => {
    // Emit z.instanceof(Buffer) as a binary blob
    if (ctx.zodSchema instanceof z.ZodCustom) {
      ctx.jsonSchema.type = 'string';
      ctx.jsonSchema.format = 'binary';
    }
  },
});
```

The user override runs **on top of** zod-nest's built-in chain (composition `allOf`, primitive overrides for bigint / date). The built-ins run first; your override sees their output and can refine further. Mutation must happen in-place — Zod's override contract doesn't propagate `ctx.jsonSchema = newBody` reassignments.

## Custom registries

`applyZodNest` reads from `defaultRegistry` unless `registry` is passed. To isolate two apps in the same process:

```ts
import { createRegistry, createZodDto } from 'zod-nest';

const appARegistry = createRegistry();
const appBRegistry = createRegistry();

// In app A's bootstrap:
class UserDto extends createZodDto(userSchema, { registry: appARegistry }) {}
const docA = applyZodNest(rawA, { app: appA, registry: appARegistry });

// In app B's bootstrap:
class UserDto extends createZodDto(userSchema, { registry: appBRegistry }) {}
const docB = applyZodNest(rawB, { app: appB, registry: appBRegistry });
```

The registries are independent — `appARegistry.ids()` won't see `appBRegistry`'s DTOs.

## Mutation contract

`applyZodNest` **mutates** the input doc and returns it. The return value is identity-equal to the input:

```ts
const doc = applyZodNest(raw, { app });
console.log(doc === raw);  // → true
```

Most callers won't care. If you need the original unmodified, deep-clone before calling:

```ts
const original = structuredClone(raw);
const doc = applyZodNest(raw, { app });
// original is untouched
```

The mutation choice trades immutability for predictable memory behavior on large docs — the alternative would have been deep-cloning every ref subtree, which scales poorly when the doc has thousands of schemas.

## When to call `applyZodNest`

After `SwaggerModule.createDocument(app, config)`, before `SwaggerModule.setup(...)`. The doc has to exist (createDocument builds it from controllers + DTOs); the setup has to receive the post-processed version (otherwise the markers leak into the served spec).

```ts
const raw = SwaggerModule.createDocument(app, config);
const doc = applyZodNest(raw, { app });
SwaggerModule.setup('docs', app, doc);
```

If you generate the spec at build time (rather than at runtime), the same pattern works — `applyZodNest` doesn't depend on the app serving the doc, only on the app being initialized so `DiscoveryService` can introspect controllers.
