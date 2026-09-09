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
  /** @deprecated 3.2 collapses named query DTOs by default. */
  queryParamStyle?: 'expand' | 'ref';
  refTitles?: boolean;
}

// All options are optional — `applyZodNest(doc)` is valid.
```

> **v2:** the `app` option was removed. Output-side DTO usage is now read from the document's `responses` (populated by `@ZodResponse`'s `@ApiResponse` bridge), so the `DiscoveryService` controller walk is gone. Replace `applyZodNest(doc, { app })` with `applyZodNest(doc)`.

| Option            | Required | Default           | What it does                                                                                                                                                                                                                                                                     |
| ----------------- | -------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry`        | no       | `defaultRegistry` | Pass an explicit registry for multi-app isolation.                                                                                                                                                                                                                               |
| `override`        | no       | `undefined`       | User-supplied emission override applied on top of the built-in overrides (composition, primitives).                                                                                                                                                                              |
| `strict`          | no       | `true`            | Strict mode throws `ZodNestUnrepresentableError` on unrepresentable Zod constructs (bigint / date / symbol / transform / …).                                                                                                                                                     |
| `queryParamStyle` | no       | version-derived   | **Deprecated.** Overrides how named `@Query()` / `@ZodQuery` DTOs render: `'expand'` (one parameter per property) or `'ref'` (collapse to one). Unset, 3.2 collapses to `in: querystring` and 3.1 expands. Query-only; see [Query parameter style](#query-parameter-style).      |
| `refTitles`       | no       | `true`            | Copy each named component's `title` (when set via `.meta({ title })`) onto every `$ref` that targets it, as a `{ $ref, title }` sibling. Helps Swagger UI's 3.1 renderer show the component name (see [`$ref` titles](#ref-titles-swagger-ui-31)). Set `false` for bare `$ref`s. |

**Output usage comes from the document.** `@ZodResponse` is a composite decorator — it applies the equivalent `@ApiResponse(...)`, so `@nestjs/swagger` writes the response shape into `paths.<route>.<method>.responses.<status>.content[...]`. `applyZodNest` reads those response `$ref`s directly, which keeps output exposure scoped to the endpoints in _this_ document (rather than every controller in the app). This is why `app` is no longer needed.

**Response cards are written by `@ZodResponse` itself.** The decorator is a composite — it applies the equivalent `@ApiResponse(...)` so `@nestjs/swagger`'s native pipeline writes `paths.<route>.<method>.responses.<status>.content[...]`. `applyZodNest` only does the marker→schema replacement pass on the placeholders that emerge from that. See [`responses.md → "OpenAPI emission"`](responses.md#openapi-emission) and [`responses.md → "Decorator ordering & the microtask trick"`](responses.md#decorator-ordering--the-microtask-trick) for the runtime details.

## The post-processing pipeline

`applyZodNest` runs these passes in order, mutating the doc as it goes:

1. **Collect usage.** Walk the document for both input-side ids (`requestBody` / `parameters` `$ref`s, plus `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` marker placeholders) and output-side ids (`responses.*.content.*` `$ref`s — `@ZodResponse`'s swagger bridge emits these via `@ApiResponse`). Produces `{ inputExposedIds, outputExposedIds }`. **Exposure is reachability-scoped: only schemas the document's endpoints actually reference are kept** — a schema put through `registerSchema()` that no endpoint reaches is _pruned_, not emitted. Two exceptions are added on top: ids registered with `{ expose: true }` (the author's explicit opt-in to document an unreferenced schema), and the query/param/header/cookie roots captured via their markers (expanded inline, but still documented). The exposure sets are then closed over `$ref`s so nested `.meta({ id })` schemas reachable from an exposed body are emitted too. Walking the document (rather than the app's controller graph) keeps exposure scoped to _this_ document — several Swagger documents sharing one registry each carry only what they use.
2. **Bulk emit.** Run `z.toJSONSchema` against the registry once per side (`input`, `output`), producing two maps `Record<dtoId, SchemaObject>`. Zod is handed a registry pre-scoped to the ids `zod-nest` itself registered — including ids discovered transitively from `.meta({ id })` on descendants of explicitly-registered DTOs. `register()` queues the schema; the Zod composition tree is walked (and every named descendant adopted) on the registry's first read, which is this pass. Deferring the walk is what makes forward and circular `z.lazy` references safe — resolving a getter at registration time would read a module binding that hasn't initialised yet. Third-party entries in `z.globalRegistry` that aren't reachable through a registered DTO are left alone — never emitted, and never strict-checked, so an unrepresentable construct inside one can't fail the build.
3. **Merge schemas.** For each id, apply the I/O suffix truth table. Equal bodies collapse to `components.schemas[id]`. Divergent bodies split as `id` (input) + `<id>Output` (output). Class-name → dtoId rename pass runs alongside.
4. **Expand parameter markers.** Walk `paths.*.<op>.parameters[]` for `__zodNestDto: true` placeholders — the byproduct of `@nestjs/swagger` exploding a `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` DTO via `_OPENAPI_METADATA_FACTORY`. Each marker becomes one parameter per top-level property of the DTO's schema, with `description` mirrored onto both the parameter object and its schema. Optional fields bound to `in: 'path'` are coerced to `required: true` with a `console.warn`, since OpenAPI 3.1 forbids optional path parameters. Non-object DTOs (arrays, unions, primitives) throw `ZodNestDocumentError({ code: 'UNEXPANDABLE_PARAM_DTO' })`. The synthetic `components.schemas.Object` placeholder that `@nestjs/swagger` materialises from the marker's `type: () => Object` is pruned once its only referrer (the marker parameter) is gone. The exception is a named `@Query()` marker that collapses instead of expanding (see [Query parameter style](#query-parameter-style)): under 3.2 to a single `in: querystring` parameter, under 3.1 to the deprecated `queryParamStyle: 'ref'` approximation. A collapse degrades back to expansion, with a warning, where 3.2's coexistence rules forbid it. See [`recipes/query-param-dtos.md`](recipes/query-param-dtos.md) for the consumer-facing pattern.
5. **Rewrite refs.** Two sub-passes: (a) class-name → dtoId rename for every `$ref` in the doc; (b) response-side `$ref` rewrite to `<id>Output` for every id in `divergentOutputIds`. Scoped to `paths.*.{op}.responses.*` so request-side refs are untouched.
6. **Strip markers.** Remove every `x-zod-nest-dto` placeholder from `components.schemas[*].properties`, drop the JSON Schema 2020-12 metadata (`$schema`, `$id`) that Zod's bulk `toJSONSchema` leaks onto every emitted body, plus any leftover marker parameter from `paths.*.<op>.parameters[]` (defensive — `expandParamMarkers` removes them in the normal path). The `$id` / `$schema` strip exists because Swagger UI's strict ref resolver re-anchors lookups against the leaf schema when `$id` is a relative URI fragment (`#/components/schemas/<Id>`) and then fails to find `components` at the new root; the fields are redundant in OpenAPI anyway since the schema's identity comes from its `components.schemas` key. Empty `properties` blocks are dropped. The `x-zod-nest-error` extension (engine collision policy) is preserved so the broken contract stays visible in Swagger UI.
7. **Inline anonymous bodies.** Every schema passed inline to `@ZodResponse` / `@ZodBody` / `@ZodMultipart` with no resolvable id (no `.meta({ id })`, no `id` option) was registered under a synthetic `anonymous` id so its body could be emitted under the document's `strict` / `override` in step 2. The merged object `@ZodBody` / `@ZodMultipart` build under `flatten: true` is always anonymous, so it takes the same route. This pass replaces each `$ref` to such an id with a deep clone of the emitted body and prunes the synthetic component — so anonymous schemas appear inline at their use site and leave no `_Anon*Schema_*` entry in `components.schemas`. Named members referenced inside the inlined body stay as `$ref`s (and remain exposed). A reused anonymous instance duplicates its body at each site; add `.meta({ id })` to share it as a named component instead.

   **Exception — recursive anonymous schemas.** A schema that references itself can't be inlined: the body carries a `$ref` back to its own component, and pruning that component would strand it. Such a schema keeps its synthetic component and is referenced by `$ref` from the operation, exactly like a named one — so `_AnonBodySchema_1` (or `_AnonResponseSchema_1`) does appear in `components.schemas`. Give it a `.meta({ id })` for a stable, readable name.

8. **Apply `$ref` titles.** Copy each named component's `title` (when set via `.meta({ title })`) onto every `$ref` that targets it, as a `{ $ref, title }` sibling. Inert annotation; helps Swagger UI's 3.1 renderer show the component name (see [`$ref` titles](#ref-titles-swagger-ui-31)). Skipped when `refTitles: false`.
9. **Assert no dangling refs.** Walk every `$ref` and confirm the target exists in `components.schemas`. Throws `ZodNestDocumentError({ code: 'DANGLING_REF' })` on the first miss, listing every offending ref with a per-ref hint inferred from collected usage.
10. **Relocate extension operations (3.2 only).** `search` and the WebDAV methods move under the path item's `additionalOperations`, keyed by uppercased method. Runs last of the mutating passes so every `$ref` walk above still sees the flat shape. No-op when targeting 3.1. See [`search` and the WebDAV methods](#search-and-the-webdav-methods).
11. **Rewrite sequential media types to `itemSchema` (3.2 only).** For every media type that carries a sequence of discrete items — SSE, NDJSON and the rest of [`SEQUENTIAL_MEDIA_TYPES`](#sequential-media-types-itemschema), plus any custom `stream: true` type — `schema` becomes `itemSchema`, so the document describes one item rather than claiming the whole body is one. Opaque byte streams (`application/octet-stream`, `image/*`, …) are untouched. Under 3.1 the pass only strips its own internal marker. See [Sequential media types](#sequential-media-types-itemschema).
12. **Normalise the OpenAPI version.** Set `doc.openapi` to the version resolved from the document, so the version string always matches the emitted body. See [OpenAPI version](#openapi-version).

The function is **composable** — apply your own doc-transform passes before or after `applyZodNest`. Just ensure that any pre-pass that touches `$ref`s knows what's coming.

## HTTP methods covered

Every pass above walks the operation keys of each path item. That set is wider than OpenAPI 3.1's
fixed `get` / `put` / `post` / `delete` / `options` / `head` / `patch` / `trace`, because
`@nestjs/swagger` lowercases whatever `RequestMethod` names into the path item — so a route declared
with an extension method lands under a key 3.1 never defined. `applyZodNest` therefore also visits
`query`, `search`, `propfind`, `proppatch`, `mkcol`, `copy`, `move`, `lock` and `unlock`.

An operation the walk skips never contributes its ids to step 1, so its schemas are pruned and its
`$ref`s fail the dangling-ref assertion in step 9 — the whole document build throws. That is why the
list has to track NestJS' router rather than the 3.1 spec.

### `QUERY` (RFC 10008)

[RFC 10008](https://www.rfc-editor.org/info/rfc10008/) defines `QUERY` as the safe, idempotent,
body-carrying method for reads whose criteria are too large or too structured for a query string.
NestJS routes it from v12 as `@QueryMethod()` — named to sidestep the existing `@Query()` parameter
decorator. Everything `zod-nest` does for a `@Post()` body applies unchanged:

```ts
@Controller('users')
class UsersController {
  @QueryMethod()
  @ZodResponse({ type: UserPageDto })
  find(@ZodBody() criteria: UserCriteriaDto): UserPageDto {
    return this.users.find(criteria);
  }
}
```

Because `QUERY` is safe, an omitted `@ZodResponse({ status })` resolves to `200` rather than `POST`'s
`201` — see [Status resolution precedence](responses.md#status-resolution-precedence).

`query` is a path-item field in OpenAPI **3.2** but not in 3.1, so a QUERY route only validates
against a strict checker when the document is emitted as 3.2 — see
[OpenAPI version](#openapi-version).

### `search` and the WebDAV methods

3.2 promoted only `query`. `search`, `propfind`, `mkcol` and friends are path-item fields in neither
version, so they need somewhere else to live — and 3.2 supplies it. When the document targets 3.2,
`applyZodNest` moves each of them under `additionalOperations`, keyed by the uppercased method:

```jsonc
"/things": {
  "get": { "…": "…" },
  "additionalOperations": {
    "SEARCH": { "operationId": "ThingsController_find", "requestBody": { "…": "…" } }
  }
}
```

The relocation is unconditional under 3.2 — it is the only representation the spec accepts, and the
schema enforces the key rules itself (an RFC 9110 token, and explicitly _not_ one of the nine
standard methods, `QUERY` included). A caller-authored `additionalOperations` entry is merged with,
never overwritten, and wins on a key collision.

> **Under 3.1 they stay inline and stay non-conformant.** 3.1 has no `additionalOperations`, so
> there is nothing to move them to. `zod-nest` emits the operation NestJS actually routed: the
> document describes your API correctly and Swagger UI renders it, but a strict 3.1 validator
> rejects the key. Emit 3.2 if you route these methods and need a conformant document.

## OpenAPI version

`applyZodNest` normalises `doc.openapi` so the version string always matches the body it emitted.
It reads whatever `DocumentBuilder` declared:

```ts
const config = new DocumentBuilder().setOpenAPIVersion('3.2.0').build();
const document = applyZodNest(SwaggerModule.createDocument(app, config));
```

| Declared on the document              | Emitted        | Warns |
| ------------------------------------- | -------------- | ----- |
| any `3.1.x` (e.g. `'3.1.0'`, `3.1.1`) | declared value | no    |
| any `3.2.x`                           | declared value | no    |
| nothing                               | `'3.1.0'`      | no    |
| anything else (incl. `'3.0.0'`)       | `'3.1.0'`      | yes   |

A supported version is passed through **verbatim**, not normalised — the accepted shape mirrors the
`^3\.1\.\d+(-.+)?$` pattern the OpenAPI schemas enforce themselves, so every patch and
pre-release they accept is accepted here and your declared string stays accurate.

> **You will see the warning unless you call the setter.** `DocumentBuilder` stamps `'3.0.0'` when
> `setOpenAPIVersion()` is never called, and `zod-nest` does not emit 3.0 — so the common case of
> never touching the setter warns and emits 3.1. Call `.setOpenAPIVersion('3.1.0')` to silence it.
> This is deliberate: silently turning a declared `3.0.0` into a 3.1 body is exactly the mismatch
> the warning exists to surface.

OpenAPI 3.2 is a **minor, fully backward-compatible** revision of 3.1 — the version tag moves
without changing how schemas are validated, and the Schema Object dialect (JSON Schema 2020-12) is
identical, so your component bodies are byte-for-byte the same either way. Five things in a
`zod-nest` document do differ, and they are the reasons to choose 3.2:

| Under 3.2                                                                                                                       | Under 3.1                                                            |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `query` is a path-item field ([RFC 10008](https://www.rfc-editor.org/info/rfc10008/), routed by NestJS 12+ as `@QueryMethod()`) | no such field — a QUERY route fails strict validation                |
| `search` / WebDAV operations live under `additionalOperations`                                                                  | no conformant home — see [below](#search-and-the-webdav-methods)     |
| SSE / NDJSON responses use `itemSchema`                                                                                         | `schema`, which overstates a stream as a single body                 |
| Response Object `summary` is emitted                                                                                            | no such field — each one is dropped, with a warning                  |
| Named query DTOs collapse to `in: querystring`                                                                                  | expanded per property, or the `queryParamStyle: 'ref'` approximation |

Keep 3.1 if your toolchain is 3.1-only; Swagger UI, Swagger Editor and Redocly all support 3.2,
but coverage across generators is still uneven.

Everything else in the document is version-neutral, **including the two objects `zod-nest` forwards
without inspecting them** — the `headers` and `links` a user hands to
[`@ZodResponse({ description })`](responses.md#response-summary-headers-and-links). The Link Object
is identical in both versions, and 3.2's Header Object is a strict superset of 3.1's. So a
passthrough payload that validates as 3.1 still validates as 3.2; switching versions can never
invalidate one.

The `summary` on that same object is the sole exception: it rides the `description` object beside
`headers` and `links`, but 3.2 added it to the Response Object and 3.1 forbids it. Targeting 3.1
therefore drops each one and warns, naming the operation and status, rather than emitting a
non-conformant document. `description` stays required in that object form regardless — 3.2 relaxed
it, but keeping it means a `zod-nest` response body is valid under both versions.

Only the reverse can bite, and only if you opt into a 3.2 feature: `allowReserved` on a header, and
`example` / `examples` on a `content`-based header, are 3.2-only and fail a 3.1 validator.

### Sequential media types (`itemSchema`)

3.1 has one field for a response body — `schema` — so a streamed endpoint documents its event DTO
there and thereby claims _the entire body is one event_. It isn't; it's a sequence. 3.2 added
`itemSchema` to the Media Type Object for exactly this, and `applyZodNest` emits it:

```jsonc
// 3.1                                          // 3.2
"text/event-stream": {                          "text/event-stream": {
  "schema": { "$ref": ".../Event" }               "itemSchema": { "$ref": ".../Event" }
}                                               }
```

`itemSchema` **replaces** `schema` rather than joining it — the spec notes that carrying both has no
real advantage over an array `schema`, and the `schema` form is the claim that was wrong to begin
with. The rewrite applies to the media types OpenAPI 3.2 names as _sequential_, exported as
`SEQUENTIAL_MEDIA_TYPES`:

`text/event-stream` · `application/x-ndjson` · `application/jsonl` · `application/json-seq` ·
`application/geo+json-seq` · `multipart/mixed`

Two kinds of media type are deliberately left on `schema`:

- **Opaque byte streams** — `application/octet-stream`, `application/pdf`, `image/*`, `audio/*`,
  `video/*`. There is no per-item schema to describe, so `itemSchema` would be meaningless.
- **Array and tuple response kinds** — `@ZodResponse({ type: [Dto, Other] })` emits `prefixItems`,
  and any array carrying its own constraints (`maxItems`) is already how 3.2 describes _complete_
  sequential content. A bare `{ type: 'array', items }` — what `@ZodResponse({ type: [Dto] })`
  produces — does collapse to `itemSchema: Dto`, since that is the same statement written twice.

A custom content type opts in with `stream: true`; see
[`recipes/streaming-responses.md`](recipes/streaming-responses.md#opting-a-custom-content-type-in).

## `$ref` titles (Swagger UI 3.1)

Swagger UI's OpenAPI **3.1** renderer inlines `$ref`-ed schemas without surfacing the referenced component's name — a property typed `{ $ref: '#/components/schemas/Foo' }` shows up as a bare `object` instead of `Foo` ([swagger-api/swagger-ui#9540](https://github.com/swagger-api/swagger-ui/issues/9540), open across 5.x). The emitted spec is valid and `$ref`-correct — this is purely a renderer limitation — but it makes complex docs hard to read.

OpenAPI 3.1 (unlike 3.0) permits sibling keywords next to `$ref`. So `applyZodNest`'s last content pass copies each component's `title` onto the refs that point at it:

```jsonc
// before
{ "foo": { "$ref": "#/components/schemas/Foo" } }
// after (Foo declared `.meta({ title: 'Foo' })`)
{ "foo": { "$ref": "#/components/schemas/Foo", "title": "Foo" } }
```

Only components that declare a `title` (via `.meta({ title })`) contribute one; refs to untitled components stay bare, and a ref that already carries its own `title` is never overwritten. The `title` is an annotation keyword — no validation effect.

> **Caveat.** This is a forward-looking aid: in swagger-ui 5.32.6 the sibling `title` is currently a visual no-op for property/array refs (the #9540 bug is deeper than missing titles). It's emitted so the names are present for 3.1-aware tooling and for whenever #9540 is fixed. If you need names rendered **today**, the working options are renderer-side: serve a 3.0-downconverted doc to Swagger UI, or use a 3.1-native renderer (Scalar, Redoc, Stoplight Elements). Set `refTitles: false` to opt out of the annotation entirely.

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

Two distinct bodies target the same `components.schemas[id]` and the merge pass can't decide which wins. `details` is `{ key, preexisting }`.

`preexisting: true` means the key was already populated before zod-nest emitted anything. On NestJS 12+ the usual cause is the native Standard Schema path — `@Body({ schema })`, `@Query({ schema })`, `@ApiResponse({ standardSchema })` — which makes `@nestjs/swagger` register the component itself under the schema's `.meta({ id })`. Route the schema through `createZodDto` / `@ZodBody` / `@ZodResponse` instead, or skip `applyZodNest` and let Nest own the document. A hand-authored component or a doc pre-pass under the same name does this too.

`preexisting: false` means two registered ids resolved to one key — in practice an `<Id>Output` sibling from a diverging input/output schema colliding with a DTO registered as `<Id>Output`. Rename one, or set a distinct `options.id`.

Note that two schemas sharing one `.meta({ id })` is a _different_ failure and doesn't throw here: the id is decorated with `x-zod-nest-error: duplicate-id` so the broken contract stays visible in Swagger UI. See [`exceptions.md`](exceptions.md#code-ambiguous_rename).

### `UNEXPANDABLE_PARAM_DTO`

A `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` handler argument resolved to a `createZodDto` whose underlying schema is not an object — e.g. `createZodDto(z.array(z.string()))` or `createZodDto(z.union([...]))`. The marker parameter has no top-level `properties` record to iterate, so the expansion step fails fast at doc-build time.

The error `details` carry `{ dtoId, in, io }` so the offending decorator is easy to locate. Mitigation — pick one:

- Use `@Body()` instead: non-object DTOs are perfectly valid request bodies.
- Restructure the schema as an object whose fields become the parameters (the more common fix when the original DTO is a tuple or discriminated union).
- For one-off primitive parameters, drop the DTO entirely and inline the type: `@Query('q') q: string` is a no-op for `ZodValidationPipe` (see [`validation-pipe.md`](validation-pipe.md)).

## Bypassing `createZodDto` for union-typed schemas

`createZodDto` requires the schema's `z.infer<>` to resolve to a single object type, since TS rejects unions as class bases (TS2509). For schemas where that doesn't hold — `z.intersection(obj, union)`, `z.discriminatedUnion`, or bare `z.union` — use the parameter-level decorators instead. They share the same registry + emission pipeline as `createZodDto` but skip the class step entirely:

| Decorator                    | OpenAPI target                                              | Schema requirement |
| ---------------------------- | ----------------------------------------------------------- | ------------------ |
| `@ZodBody(schema, opts?)`    | request body — `requestBody.content[...].schema`            | any                |
| `@ZodQuery(schema, opts?)`   | query parameters — per-property, or one collapsed parameter | must be `z.object` |
| `@ZodHeaders(schema, opts?)` | one header parameter per top-level property                 | must be `z.object` |
| `@ZodCookies(schema, opts?)` | one cookie parameter per top-level property                 | must be `z.object` |

All decorators are method-level (applied next to `@Get` / `@Post` / etc.). Validation stays a separate concern — pair with `@Body(new ZodValidationPipe(schema))` (or `@Query(...)`, etc.) at the parameter so the handler arg keeps a precise `z.infer<>` type.

Schema id resolution mirrors `createZodDto`: `options.id` overrides any `.meta({ id })` on the schema. When the schema has no id, the JSON Schema body is inlined directly into the operation (the schema is not added to `components.schemas` for reuse — that's the documented trade-off for anonymous use).

`@ZodBody` accepts an opt-in `flatten: true` that merges intersection-of-object arms into a single inline object body. Use it when Swagger UI's `multipart/form-data` `try-it-out` form needs to render the body — the UI doesn't follow `$ref` or unwrap `allOf`. The merged body is emitted at doc-build time like any other anonymous body, so `applyZodNest`'s `strict` and `override` apply to it. See [`recipes/intersection-with-union.md`](recipes/intersection-with-union.md) for the trade-off (no `components.schemas` entry for the merged root) and the full pattern.

For the full pattern with code, see [`recipes/intersection-with-union.md`](recipes/intersection-with-union.md).

## Query parameter style

By default, a named query DTO — whether bound as `@Query() params: SomeDto` (a `createZodDto` class) or declared with `@ZodQuery(schema)` — is **expanded** into one OpenAPI parameter per top-level property. The named root object also lands in `components.schemas`: the decorator emits a marker carrying the root's id, which the collect-usage pass picks up and exposes even though no `$ref` points at it after expansion — so the shape is both expanded _and_ documented as a component. (This is specific to query: `@ZodHeaders` / `@ZodCookies` expand eagerly without a root marker, so their root object is pruned unless referenced elsewhere — the per-property parameters carry the full contract.)

**Under OpenAPI 3.2 a named query DTO collapses instead**, to the single `in: querystring` parameter 3.2 introduced for exactly this — one Schema Object describing the whole query string. No option needed:

```ts
const doc = applyZodNest(raw); // doc declared 3.2 via setOpenAPIVersion('3.2.0')
```

```yaml
# 3.1 — expanded                      # 3.2 — querystring
parameters:                           parameters:
  - { name: timeFrom, in: query, … }    - name: ActivityQuery
  - { name: timeTo,   in: query, … }      in: querystring
  - { name: search,   in: query, … }      required: true
  - { name: userId,   in: query, … }      content:
                                            application/x-www-form-urlencoded:
                                              schema: { $ref: '#/components/schemas/ActivityQuery' }
```

`content` is mandatory on `in: querystring` — 3.2 forbids `schema` and `style` there. The media type describes how a query string is encoded, which it always was; nothing changes on the wire, and `?timeFrom=…&timeTo=…` is unaffected. The one nuance: form-urlencoded's canonical space encoding is `+` where RFC 6570's `form` style gives `%20`. The spec permits both, so no client or server breaks — a generated client may simply prefer `+`.

`required` follows the Zod schema: `true` when at least one field is required (so the query string must be present), `false` when every field is optional. Per-field requiredness stays in the referenced component's `required` array.

### When collapsing degrades to expansion

3.2 allows **at most one** `querystring` parameter per operation, and forbids it **alongside any `in: query` parameter** in the operation or its path item. Where that would be violated, `zod-nest` expands per property instead and warns — the document stays valid rather than failing the build:

```ts
@Get()
list(@Query() filters: FiltersDto, @Query('page') page: string) {} // expands both, warns
```

The same fallback applies, silently, when the DTO has no component to reference.

### The 3.1 approximation (`queryParamStyle: 'ref'`) — deprecated

3.1 has no way to say "the whole query string is this schema", so `queryParamStyle: 'ref'` approximated it with `style: form` + `explode: true` + `schema: { $ref }`. The wire format matched the expanded form; only the document representation collapsed.

```ts
const doc = applyZodNest(raw, { queryParamStyle: 'ref' }); // 3.1 only
```

Since 3.2 expresses this natively, both `queryParamStyle` and `@ZodQuery`'s `ref` option are **deprecated and will be removed in the next major**, after which 3.1 always expands and 3.2 always collapses. Under 3.2 an explicit value still wins — `queryParamStyle: 'expand'` is the escape hatch if you prefer expanded parameters in Swagger UI's "try it out" — but it warns.

**Query-only.** `@Param()` / `@Headers()` / `@Cookie()` DTOs always expand — collapsing an object into one parameter is a query serialization, and path parameters can't be an object `$ref`.

### Per-handler override (deprecated)

`@ZodQuery` takes a `ref` option that wins over both the global preference and the version:

```ts
@Get('activities')
@ZodQuery(ActivityQuerySchema, { ref: false })   // keep this one expanded under 3.2
getActivities(
  @Query(new ZodValidationPipe(ActivityQuerySchema)) params: ActivityQuery,
): void {}
```

- `ref: true` — always collapse (`in: querystring` under 3.2, `style: form` under 3.1).
- `ref: false` — always expand per property.
- unset — follow `queryParamStyle`, then the target version.

Collapsing needs a named schema to reference. `@ZodQuery({ ref: true })` on an anonymous schema (no `.meta({ id })`, no `id` option) throws `ZodNestError`; an anonymous `@ZodQuery` always expands. The `@Query() dto` path always has a name (the DTO id), so it always collapses under 3.2 — it has no per-handler flag, so `queryParamStyle: 'expand'` is the only way to opt it out.

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

The check is scoped to what the document emits — the registered ids plus their `.meta({ id })` descendants. A schema sitting in `z.globalRegistry` that no DTO reaches (a wire codec, a third-party library's schema) is neither emitted nor checked, so it can't fail the build.

Mitigation — three options, most-targeted first:

1. **`overrideJSONSchema(schema, fragment)`** — register a fixed JSON Schema fragment for a specific schema _instance_. Best for `z.custom` / `z.instanceof` (e.g. multipart `File` fields — for multer / `@fastify/multipart` upload fields specifically, use the platform helpers in [`file-uploads.md`](file-uploads.md), which wire this up for you). Pass `{ input, output }` instead of a raw fragment when the request and response sides need different shapes. See [`recipes/custom-openapi-overrides.md`](recipes/custom-openapi-overrides.md#per-instance-registration-with-overridejsonschema).
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
