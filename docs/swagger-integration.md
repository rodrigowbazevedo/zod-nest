# Swagger integration (`applyZodNest`)

`applyZodNest(rawDoc, options)` is the single post-processor that runs after `SwaggerModule.createDocument(...)`. It walks the doc, replaces every `x-zod-nest-dto` marker with the real Zod-derived JSON Schema, expands every `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` DTO marker into individual parameter entries, applies the I/O suffix truth table, strips the markers, validates the ref graph, sets `openapi: '3.1.0'`, and returns the same (mutated) document for compositional convenience.

```ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applyZodNest } from 'zod-nest';

const raw = SwaggerModule.createDocument(
  app,
  new DocumentBuilder().setTitle('Users').setVersion('1').build(),
);
const doc = applyZodNest(raw);
SwaggerModule.setup('docs', app, doc);
```

One call replaces the entire `cleanupOpenApiDoc` ritual that earlier libraries needed. No 3.0 fallback — `applyZodNest` writes `openapi: '3.1.0'` on the doc as its final step, regardless of how `DocumentBuilder` was configured.

## Options

```ts
interface ApplyZodNestOptions {
  registry?: ZodNestRegistry;
  override?: Override;
  strict?: boolean;
  queryParamStyle?: 'expand' | 'ref';
}

// All options are optional — `applyZodNest(doc)` is valid.
```

> **v2:** the `app` option was removed. Output-side DTO usage is now read from the document's `responses` (populated by `@ZodResponse`'s `@ApiResponse` bridge), so the `DiscoveryService` controller walk is gone. Replace `applyZodNest(doc, { app })` with `applyZodNest(doc)`.

| Option            | Required | Default           | What it does                                                                                                                 |
| ----------------- | -------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `registry`        | no       | `defaultRegistry` | Pass an explicit registry for multi-app isolation.                                                                           |
| `override`        | no       | `undefined`       | User-supplied emission override applied on top of the built-in overrides (composition, primitives).                          |
| `strict`          | no       | `true`            | Strict mode throws `ZodNestUnrepresentableError` on unrepresentable Zod constructs (bigint / date / symbol / transform / …). |
| `queryParamStyle` | no       | `'expand'`        | How named `@Query()` / `@ZodQuery` DTOs render: `'expand'` (one parameter per property) or `'ref'` (a single schema-based parameter that `$ref`s the component). Query-only; see [Query parameter style](#query-parameter-style). |

**Output usage comes from the document.** `@ZodResponse` is a composite decorator — it applies the equivalent `@ApiResponse(...)`, so `@nestjs/swagger` writes the response shape into `paths.<route>.<method>.responses.<status>.content[...]`. `applyZodNest` reads those response `$ref`s directly, which keeps output exposure scoped to the endpoints in *this* document (rather than every controller in the app). This is why `app` is no longer needed.

**Response cards are written by `@ZodResponse` itself.** The decorator is a composite — it applies the equivalent `@ApiResponse(...)` so `@nestjs/swagger`'s native pipeline writes `paths.<route>.<method>.responses.<status>.content[...]`. `applyZodNest` only does the marker→schema replacement pass on the placeholders that emerge from that. See [`responses.md → "OpenAPI emission"`](responses.md#openapi-emission) and [`responses.md → "Decorator ordering & the microtask trick"`](responses.md#decorator-ordering--the-microtask-trick) for the runtime details.

## The post-processing pipeline

`applyZodNest` runs these passes in order, mutating the doc as it goes:

1. **Collect usage.** Walk the document for both input-side ids (`requestBody` / `parameters` `$ref`s, plus `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` marker placeholders) and output-side ids (`responses.*.content.*` `$ref`s — `@ZodResponse`'s swagger bridge emits these via `@ApiResponse`). Produces `{ inputExposedIds, outputExposedIds }`. **Exposure is reachability-scoped: only schemas the document's endpoints actually reference are kept** — a schema put through `registerSchema()` that no endpoint reaches is *pruned*, not emitted. Two exceptions are added on top: ids registered with `{ expose: true }` (the author's explicit opt-in to document an unreferenced schema), and the query/param/header/cookie roots captured via their markers (expanded inline, but still documented). The exposure sets are then closed over `$ref`s so nested `.meta({ id })` schemas reachable from an exposed body are emitted too. Walking the document (rather than the app's controller graph) keeps exposure scoped to *this* document — several Swagger documents sharing one registry each carry only what they use.
2. **Bulk emit.** Run `z.toJSONSchema` against the registry once per side (`input`, `output`), producing two maps `Record<dtoId, SchemaObject>`. Filtered to the ids `zod-nest` itself registered — including ids discovered transitively from `.meta({ id })` on descendants of explicitly-registered DTOs (`createZodDto` calls `register()`, which walks the Zod composition tree and adopts every named descendant). Third-party entries in `z.globalRegistry` that aren't reachable through a registered DTO are left alone.
3. **Merge schemas.** For each id, apply the I/O suffix truth table. Equal bodies collapse to `components.schemas[id]`. Divergent bodies split as `id` (input) + `<id>Output` (output). Class-name → dtoId rename pass runs alongside.
4. **Expand parameter markers.** Walk `paths.*.<op>.parameters[]` for `__zodNestDto: true` placeholders — the byproduct of `@nestjs/swagger` exploding a `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` DTO via `_OPENAPI_METADATA_FACTORY`. Each marker becomes one parameter per top-level property of the DTO's schema, with `description` mirrored onto both the parameter object and its schema. Optional fields bound to `in: 'path'` are coerced to `required: true` with a `console.warn`, since OpenAPI 3.1 forbids optional path parameters. Non-object DTOs (arrays, unions, primitives) throw `ZodNestDocumentError({ code: 'UNEXPANDABLE_PARAM_DTO' })`. The synthetic `components.schemas.Object` placeholder that `@nestjs/swagger` materialises from the marker's `type: () => Object` is pruned once its only referrer (the marker parameter) is gone. The exception is a `@Query()` marker under ref mode (see [Query parameter style](#query-parameter-style)), which collapses to a single `$ref` parameter instead of expanding. See [`recipes/query-param-dtos.md`](recipes/query-param-dtos.md) for the consumer-facing pattern.
5. **Rewrite refs.** Two sub-passes: (a) class-name → dtoId rename for every `$ref` in the doc; (b) response-side `$ref` rewrite to `<id>Output` for every id in `divergentOutputIds`. Scoped to `paths.*.{op}.responses.*` so request-side refs are untouched.
6. **Strip markers.** Remove every `x-zod-nest-dto` placeholder from `components.schemas[*].properties`, drop the JSON Schema 2020-12 metadata (`$schema`, `$id`) that Zod's bulk `toJSONSchema` leaks onto every emitted body, plus any leftover marker parameter from `paths.*.<op>.parameters[]` (defensive — `expandParamMarkers` removes them in the normal path). The `$id` / `$schema` strip exists because Swagger UI's strict ref resolver re-anchors lookups against the leaf schema when `$id` is a relative URI fragment (`#/components/schemas/<Id>`) and then fails to find `components` at the new root; the fields are redundant in OpenAPI anyway since the schema's identity comes from its `components.schemas` key. Empty `properties` blocks are dropped. The `x-zod-nest-error` extension (engine collision policy) is preserved so the broken contract stays visible in Swagger UI.
7. **Inline anonymous bodies.** Every schema passed inline to `@ZodResponse` / `@ZodBody` with no resolvable id (no `.meta({ id })`, no `id` option) was registered under a synthetic `anonymous` id so its body could be emitted under the document's `strict` / `override` in step 2. This pass replaces each `$ref` to such an id with a deep clone of the emitted body and prunes the synthetic component — so anonymous schemas appear inline at their use site and never leave a `_Anon*Schema_*` entry in `components.schemas`. Named members referenced inside the inlined body stay as `$ref`s (and remain exposed). A reused anonymous instance duplicates its body at each site; add `.meta({ id })` to share it as a named component instead.
8. **Assert no dangling refs.** Walk every `$ref` and confirm the target exists in `components.schemas`. Throws `ZodNestDocumentError({ code: 'DANGLING_REF' })` on the first miss, listing every offending ref with a per-ref hint inferred from collected usage.
9. **Force OpenAPI 3.1.** Set `doc.openapi = '3.1.0'` so the version string matches the emitted body even when `DocumentBuilder.setOpenAPIVersion('3.1.0')` was not called on the caller side.

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
  readonly code: 'AMBIGUOUS_RENAME' | 'DANGLING_REF' | 'UNEXPANDABLE_PARAM_DTO';
  readonly details: Readonly<Record<string, unknown>>;
}
```

### `AMBIGUOUS_RENAME`

Two distinct DTO classes target the same registry id with differing bodies. The rename pass can't write `components.schemas[id]` unambiguously — which body wins?

Typical cause: copy-pasted `createZodDto(otherSchema, { id: 'User' })` somewhere, or two `.meta({ id: 'User' })` calls on different schemas. Fix by giving each schema a unique id.

### `UNEXPANDABLE_PARAM_DTO`

A `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` handler argument resolved to a `createZodDto` whose underlying schema is not an object — e.g. `createZodDto(z.array(z.string()))` or `createZodDto(z.union([...]))`. The marker parameter has no top-level `properties` record to iterate, so the expansion step fails fast at doc-build time.

The error `details` carry `{ dtoId, in, io }` so the offending decorator is easy to locate. Mitigation — pick one:

- Use `@Body()` instead: non-object DTOs are perfectly valid request bodies.
- Restructure the schema as an object whose fields become the parameters (the more common fix when the original DTO is a tuple or discriminated union).
- For one-off primitive parameters, drop the DTO entirely and inline the type: `@Query('q') q: string` is a no-op for `ZodValidationPipe` (see [`validation-pipe.md`](validation-pipe.md)).

## Bypassing `createZodDto` for union-typed schemas

`createZodDto` requires the schema's `z.infer<>` to resolve to a single object type, since TS rejects unions as class bases (TS2509). For schemas where that doesn't hold — `z.intersection(obj, union)`, `z.discriminatedUnion`, or bare `z.union` — use the parameter-level decorators instead. They share the same registry + emission pipeline as `createZodDto` but skip the class step entirely:

| Decorator                    | OpenAPI target                                   | Schema requirement |
| ---------------------------- | ------------------------------------------------ | ------------------ |
| `@ZodBody(schema, opts?)`    | request body — `requestBody.content[...].schema`            | any                |
| `@ZodQuery(schema, opts?)`   | query parameters — per-property, or one `$ref` in ref mode  | must be `z.object` |
| `@ZodHeaders(schema, opts?)` | one header parameter per top-level property                 | must be `z.object` |
| `@ZodCookies(schema, opts?)` | one cookie parameter per top-level property                 | must be `z.object` |

All decorators are method-level (applied next to `@Get` / `@Post` / etc.). Validation stays a separate concern — pair with `@Body(new ZodValidationPipe(schema))` (or `@Query(...)`, etc.) at the parameter so the handler arg keeps a precise `z.infer<>` type.

Schema id resolution mirrors `createZodDto`: `options.id` overrides any `.meta({ id })` on the schema. When the schema has no id, the JSON Schema body is inlined directly into the operation (the schema is not added to `components.schemas` for reuse — that's the documented trade-off for anonymous use).

`@ZodBody` accepts an opt-in `flatten: true` that merges intersection-of-object arms into a single inline object body. Use it when Swagger UI's `multipart/form-data` `try-it-out` form needs to render the body — the UI doesn't follow `$ref` or unwrap `allOf`. See [`recipes/intersection-with-union.md`](recipes/intersection-with-union.md) for the trade-off (no `components.schemas` entry for the merged root) and the full pattern.

For the full pattern with code, see [`recipes/intersection-with-union.md`](recipes/intersection-with-union.md).

## Query parameter style

By default, a named query DTO — whether bound as `@Query() params: SomeDto` (a `createZodDto` class) or declared with `@ZodQuery(schema)` — is **expanded** into one OpenAPI parameter per top-level property. The named root object also lands in `components.schemas`: the decorator emits a marker carrying the root's id, which the collect-usage pass picks up and exposes even though no `$ref` points at it after expansion — so the shape is both expanded *and* documented as a component. (This is specific to query: `@ZodHeaders` / `@ZodCookies` expand eagerly without a root marker, so their root object is pruned unless referenced elsewhere — the per-property parameters carry the full contract.)

Set `queryParamStyle: 'ref'` on `applyZodNest` to instead emit a single **schema-based** query parameter that references the shared component:

```ts
const doc = applyZodNest(raw, { queryParamStyle: 'ref' });
```

```yaml
# expand (default)                    # ref
parameters:                           parameters:
  - { name: timeFrom, in: query, … }    - in: query
  - { name: timeTo,   in: query, … }      name: ActivityQuery
  - { name: search,   in: query, … }      required: true
  - { name: userId,   in: query, … }      style: form
                                          explode: true
                                          schema: { $ref: '#/components/schemas/ActivityQuery' }
```

The **wire format is identical** — `style: form` + `explode: true` serializes the object's properties as `?timeFrom=…&timeTo=…`, exactly like the expanded form. Only the document representation changes: the spec now points at the existing component instead of duplicating each field inline. The parameter is marked `required: true` when the schema has at least one required field; per-field requiredness stays in the referenced component's `required` array.

**Swagger UI renders the two forms differently** (one combined object input vs. one input per field), which is why `expand` remains the default and `ref` is opt-in.

**Query-only.** `@Param()` / `@Headers()` / `@Cookie()` DTOs always expand — the form-exploded-object pattern is a query serialization, and path parameters can't be an object `$ref`.

### Per-handler override

`@ZodQuery` takes a `ref` option that wins over the global preference:

```ts
@Get('activities')
@ZodQuery(ActivityQuerySchema, { ref: true })   // force a single $ref param here
getActivities(
  @Query(new ZodValidationPipe(ActivityQuerySchema)) params: ActivityQuery,
): void {}
```

- `ref: true` — always emit the single `$ref` parameter.
- `ref: false` — always expand per property.
- unset — follow `applyZodNest`'s `queryParamStyle` (default `'expand'`).

Ref mode needs a named schema to reference. `@ZodQuery({ ref: true })` on an anonymous schema (no `.meta({ id })`, no `id` option) throws `ZodNestError`; an anonymous `@ZodQuery` always expands regardless of the global preference. The `@Query() dto` path always has a name (the DTO id), so it always honors `queryParamStyle`.

### `DANGLING_REF`

A `$ref` in the doc points at a `components.schemas` key that no longer exists after `applyZodNest`. Usually means:

- A marker was stripped but its rename target wasn't populated — typically a registry mismatch where the DTO is referenced via `@Body() body: UserDto` but `UserDto` wasn't registered to the right `ZodNestRegistry`.
- A user-supplied pre-pass left a stale ref behind.
- A `.meta({ id })` typo — the schema is registered under `User`, but the consumer refers to `Users`.
- A named sub-schema referenced from a registered DTO's tree but never wrapped in `createZodDto` and never registered. `extend()` parents are auto-resolved since 1.6 (via `registerSchema`); for other cases, call `registerSchema(schema)` once or wrap the schema in `createZodDto`.

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

1. **`overrideJSONSchema(schema, fragment)`** — register a fixed JSON Schema fragment for a specific schema _instance_. Best for `z.custom` / `z.instanceof` (e.g. multipart `File` fields). Pass `{ input, output }` instead of a raw fragment when the request and response sides need different shapes. See [`recipes/custom-openapi-overrides.md`](recipes/custom-openapi-overrides.md#per-instance-registration-with-overridejsonschema).
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
const docA = applyZodNest(rawA, { registry: appARegistry });

// In app B's bootstrap:
class UserDto extends createZodDto(userSchema, { registry: appBRegistry }) {}
const docB = applyZodNest(rawB, { registry: appBRegistry });
```

The registries are independent — `appARegistry.ids()` won't see `appBRegistry`'s DTOs.

## Mutation contract

`applyZodNest` **mutates** the input doc and returns it. The return value is identity-equal to the input:

```ts
const doc = applyZodNest(raw);
console.log(doc === raw); // → true
```

Most callers won't care. If you need the original unmodified, deep-clone before calling:

```ts
const original = structuredClone(raw);
const doc = applyZodNest(raw);
// original is untouched
```

The mutation choice trades immutability for predictable memory behavior on large docs — the alternative would have been deep-cloning every ref subtree, which scales poorly when the doc has thousands of schemas.

## When to call `applyZodNest`

After `SwaggerModule.createDocument(app, config)`, before `SwaggerModule.setup(...)`. The doc has to exist (createDocument builds it from controllers + DTOs); the setup has to receive the post-processed version (otherwise the markers leak into the served spec).

```ts
const raw = SwaggerModule.createDocument(app, config);
const doc = applyZodNest(raw);
SwaggerModule.setup('docs', app, doc);
```

If you generate the spec at build time (rather than at runtime), the same pattern works — `applyZodNest` doesn't depend on the app serving the doc, only on the app being initialized so `DiscoveryService` can introspect controllers.
