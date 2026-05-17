# Why this exists

`zod-nest` started as a fork of [`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) inside a private NestJS service. The fork accumulated workarounds — `cleanupOpenApiDoc` post-processes, manual `@ApiResponse` stacking for multi-status responses, `@ts-ignore` shims for Zod v3 / v4 type drift, custom interceptors to handle the cases where `@ZodSerializerDto` didn't quite fit — until it became clear that the underlying constraints (Zod v3 + class-validator interop + OpenAPI 3.0 fallback) were no longer worth preserving.

This is a fresh take, scoped to one thing: **Zod v4 → NestJS → OpenAPI 3.1, with no dual codepaths and no post-process ritual**.

## What's intentionally dropped

### Zod v3 support

Zod v4 changed the schema introspection API in ways that make the v3-or-v4 dual codepath fragile. Maintaining both means every override, every emission path, every type guard has two branches and twice the surface area for `@ts-ignore`. We pick one: **v4 only**.

If you're on v3, [Zod's v3-to-v4 migration guide](https://zod.dev/v4) is the path forward. The upgrade is mechanical for most schemas; the win on the OpenAPI side comes from `z.toJSONSchema`, which v4 ships natively.

### `class-validator` / `class-transformer` coexistence

`nestjs-zod` worked alongside class-validator DTOs — `createZodDto` returned a class that could carry both `@IsString()` decorators and a Zod schema, and the pipe knew how to dispatch. The result was useful for incremental migrations but produced sprawling internals.

`zod-nest` is **Zod-native**. Mixing class-validator decorators on a `createZodDto` result is unsupported. If your project still relies on class-validator for some DTOs, those DTOs stay as plain `@nestjs/swagger`-decorated classes — `zod-nest` doesn't touch them. Hybrid projects work as long as each DTO sticks to one library.

### OpenAPI 3.0 fallback

`@nestjs/swagger` emits OpenAPI 3.1 by default in modern versions. The 3.0 fallback path required emitting `nullable: true` instead of `type: [..., 'null']`, rewriting `examples` to `example`, downgrading `prefixItems` tuples, and post-processing `$ref` paths. We drop all of it.

If you need to serve OpenAPI 3.0 to a client that can't speak 3.1, run a downgrade pass *after* `applyZodNest` — there are good standalone tools for it. `zod-nest` itself emits 3.1 only.

### `cleanupOpenApiDoc` as a separate post-process

`nestjs-zod` shipped a `cleanupOpenApiDoc` function that ran after `SwaggerModule.createDocument`. Forgetting to call it left ~10 `x-nestjs_zod-*` extension keys in the final spec; calling it twice or in the wrong order produced silent breakage.

`applyZodNest` replaces it. One call, after `createDocument`, before `setup`. The doc the function returns is the doc `setup` should receive. There's no "did you remember to clean up" step.

### Hidden `@HttpCode` application

`nestjs-zod`'s response decorators set `@HttpCode` implicitly in some configurations. The consequence was that `@HttpCode(204)` could be silently overridden by `@ZodSerializerDto(EmptyDto)`, or vice versa, depending on import order and decorator application order.

`zod-nest` doesn't apply `@HttpCode` from inside `@ZodResponse`. The status the client sees is whatever NestJS resolves from `@HttpCode(...)` → method default. `@ZodResponse({ status })` only affects **which response variant** matches that status for validation purposes. See [`responses.md`](responses.md#status-resolution-precedence).

### Status wildcards in response decorators

`'2XX'`, `'default'`, and similar wildcard statuses in `@ApiResponse` are useful for sketching contracts, but they make per-status validation ambiguous (which schema applies when the wildcard matches?). The v0 surface uses explicit numeric statuses only. Wildcards may come back in v1 with a clear resolution policy.

## What's deliberately kept simple

### One pipe, one interceptor, one doc post-processor

Three integration points. `ZodValidationPipe` handles input, `ZodSerializerInterceptor` handles output, `applyZodNest` handles the doc. Each is configurable enough for the cases that come up in practice, but the surface stays small.

The module (`ZodNestModule.forRoot`) wires all three globally with shared options. It's optional — every piece works standalone.

### One source of truth: the Zod schema

Each DTO is one Zod schema in one class. The schema drives validation, the schema drives emission, the schema is what you read when you want to know what the DTO looks like. There's no duplicate description in decorators, no `@ApiProperty()` on every field, no separate type definition.

For things you'd normally attach to fields via decorators (`title`, `description`, `examples`, `deprecated`), Zod's `.meta({ ... })` covers them at any nesting depth. See [`dto.md → Schema metadata for Swagger UI`](dto.md#schema-metadata-for-swagger-ui).

### Customisable, not configurable

The library prefers to **customize via callback** rather than configure via flag. Exception factories take a function, not a string-keyed enum. Custom emission overrides take a function, not a feature toggle. The same source code handles every customization; no branches, no flags, no "this only works when option X is enabled".

This trades a small amount of upfront learning (you have to write a few lines instead of flipping a switch) for a much smaller maintenance surface. Most projects will never reach for the callbacks; the ones that do can do anything.

### Forward-compatible via Zod's emitter

`zod-nest` doesn't maintain its own Zod → JSON Schema emitter. It calls Zod v4's built-in `z.toJSONSchema(...)` and post-processes the output (I/O suffix split, marker stripping, ref rewriting, the composition `allOf` override). This means the library's emission semantics ride on Zod's:

- New Zod types (or new representations of existing types) become representable in `zod-nest` the moment Zod ships them.
- JSON Schema draft updates and OpenAPI 3.x compatibility tweaks land via Zod releases rather than `zod-nest` releases.
- Per-construct emission options (`metadata`, `unionStrategy`, `reused`, `target`) are configurable through Zod's surface; `zod-nest` threads them through `buildToJsonSchemaOptions` without inventing a parallel knob system.

The non-Zod work `zod-nest` carries — wiring DTOs into NestJS, splitting the I/O suffix, validating the final ref graph, surfacing doc-build errors — is the part that genuinely needs library code. The shape of the JSON Schema itself is Zod's job, and tying the library to Zod's roadmap is a deliberate choice over reimplementing a moving target.

## What's experimental

The composition layer (`extend`, `getLineage`) is `@experimental`. The basic API is unlikely to change, but the emission shape, the `LineageEntry` type, and the multi-hop behaviour may all evolve. Production tooling that depends on the composition layer should pin a minor version. See [`composition.md → Why @experimental`](composition.md#why-experimental).

Everything else — DTOs, validation, response stacking, doc post-processing — is intended to stay stable through v1.

## The bigger picture

`zod-nest` is a small library on a narrow problem. The goal isn't to subsume every Zod-related NestJS workflow; it's to give you one source of truth (the schema), a few well-placed extension points (exception factories, custom emission), and a final doc you can ship to clients without a checklist of post-process steps.

If you're already comfortable with Zod and NestJS, the surface should feel like an obvious next step — `createZodDto`, `@ZodResponse`, `applyZodNest`, done. If you're not, the [`quickstart`](../README.md#quickstart) walks through it end to end.
