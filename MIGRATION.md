# Migrating from `nestjs-zod`

> **Prefer driving this migration with Claude / Cursor?** `npx skills add rodrigowbazevedo/zod-nest --skill zod-nest-migrate` installs an AI-agent skill that walks through the 8 steps below with per-step confirmation. See [`docs/skills.md`](docs/skills.md) for details.

This guide is for projects on the public [`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) package migrating to `zod-nest`. The mechanical bits (uninstall, reinstall, swap imports) are quick; the behavioural changes (status resolution, I/O suffix, no `cleanupOpenApiDoc`) take a more careful read.

## TL;DR — 5 bullets

1. **Bump Zod to v4** (`zod@^4`). `zod-nest` is v4-only.
2. **Replace `cleanupOpenApiDoc(SwaggerModule.createDocument(...))` with `applyZodNest(SwaggerModule.createDocument(...), { app })`.** One call, mutates the doc, returns it.
3. **`@ZodResponse` keeps the same name and call shape** — only the import source changes. New superpowers: it stacks per status code, and it no longer applies `@HttpCode` internally.
4. **If you used `@ZodResponse({ status: X })` to also set the HTTP status, add an explicit `@HttpCode(X)`.** `nestjs-zod`'s `@ZodResponse` was a composite that called `@HttpCode` for you; `zod-nest`'s doesn't.
5. **DTO discriminator changed** — `Symbol.for('zod-nest.dto')` instead of `MyDto.isZodDto`. Check any reflection-based code.

## Prerequisites

- **Zod `>=4.4.0 <5.0.0`**. Migrate from v3 first if you haven't; [Zod's v3-to-v4 guide](https://zod.dev/v4) is the path.
- **NestJS `>=11.0.1 <12.0.0`** (both `@nestjs/common` and `@nestjs/core`). **`@nestjs/swagger` `>=11.0.0 <12.0.0`** — swagger 11 was the first release to accept nest 11 as a peer.
- **`rxjs` `>=7.1.0 <8.0.0`** (typically pulled in transitively by NestJS).
- **`reflect-metadata` `>=0.2.0 <0.3.0`** — this is now a declared peer; install it explicitly if your existing setup only had it transitively from NestJS 10.
- **Node `>=22`**.
- **Drop `class-validator` / `class-transformer`** if you installed them only for `nestjs-zod` interop. If they're used elsewhere in your app (legacy DTOs, custom validators), leave them — `zod-nest` doesn't conflict, it just doesn't interoperate.

> Coming from NestJS 10? `zod-nest >=0.13.0` requires NestJS 11. NestJS 10 was dropped because it conflicts at install with the `reflect-metadata` 0.2.x line — the prior peer-dep declaration was wrong about supporting it.

## Install / uninstall

```bash
npm uninstall nestjs-zod
npm install zod-nest zod@^4
```

Peer dependencies (`@nestjs/common`, `@nestjs/core`, `@nestjs/swagger`, `rxjs`, `reflect-metadata`) are not bundled — they come from your app.

## Breaking changes (side-by-side)

| Concern | `nestjs-zod` | `zod-nest` |
|---|---|---|
| Zod version | v3 + v4 | v4 only |
| Doc entry point | `cleanupOpenApiDoc(SwaggerModule.createDocument(...))` | `applyZodNest(rawDoc, { app })` (mutates + returns) |
| Single-status response | `@ZodResponse({ type: Dto })` (composite of `@ZodSerializerDto` + `@ApiResponse` + `@HttpCode`) | `@ZodResponse({ type: Dto })` (composite of variant registration + `@ApiResponse`; **no internal `@HttpCode`** — caller controls status via `@HttpCode(n)`) |
| Older single-status pattern | `@ZodSerializerDto(Dto) + @ApiOkResponse({ type: Dto })` | `@ZodResponse({ type: Dto })` |
| Multi-status responses | not stackable (`@ZodResponse` validates type-consistency at decoration time) | stack `@ZodResponse` calls; status inferred for the default variant |
| Internal `@HttpCode` | `@ZodResponse({ status })` calls `@HttpCode(status)` internally | not applied — caller controls actual status via `@HttpCode(n)` |
| I/O suffix | always `_Output` | only when input and output JSON Schemas actually differ |
| DTO discriminator | `MyDto.isZodDto === true` | `Symbol.for('zod-nest.dto') in MyDto` |
| `io` representation | symbol | string (`'input' \| 'output'`) |
| Codec mode | `createZodDto(s, { codec: true })` flag | express in schema (`z.pipe`, `z.transform`); no flag |
| Validation exception customization | input-side only | both pipe **and** interceptor; factory on each |
| Serialization exception response body | exposes the zod error tree | opaque (`{ statusCode, message }`) — tree goes to logs only |
| Validation-failure logging | none | `validationLogs: boolean \| { input?, output? }` |
| Logger override | none | `logger: LoggerService` |
| Log redaction | n/a | `redactKeys: readonly string[]` (replaces default list, no merge) |
| Log truncation | n/a | `maxLoggedValueBytes: number` (default 4096) |
| Doc-build errors | silent / dangling refs at runtime | `ZodNestDocumentError` (`AMBIGUOUS_RENAME` / `DANGLING_REF` / `UNEXPANDABLE_PARAM_DTO`) — fails fast |
| `@Query()` / `@Param()` / `@Headers()` DTO expansion | exploded by `cleanupOpenApiDoc` based on `PREFIX` placeholder | exploded by `applyZodNest`'s `expandParamMarkers` pass — symmetric output, one parameter per top-level field |
| OpenAPI version on emitted doc | derived from `DocumentBuilder.setOpenAPIVersion(...)` (defaults to `'3.0.0'`) | forced to `'3.1.0'` by `applyZodNest` regardless of `DocumentBuilder` config |
| Composition (experimental) | not a feature | `extend()` + `getLineage()` — `@experimental` |
| Internal extension keys in spec | ~10 `x-nestjs_zod-*` keys remain | 0 (stripped at exit) |
| `$ref` paths | post-process rewrite | emitted correctly by Zod's `uri` callback |
| `createZodGuard` / `validate()` | exported | dropped (use `schema.parse` / `schema.safeParse`) |

## Step-by-step migration

### Step 1 — bump Zod

```diff
{
  "dependencies": {
-   "zod": "^3"
+   "zod": "^4"
  }
}
```

If your codebase still uses Zod v3 APIs, work through Zod's own [v3-to-v4 migration](https://zod.dev/v4) first. The big behavioural changes:
- `z.string().email()` → `z.email()` (similar for `url`, `uuid`, `cuid`, `iso.datetime()`, etc.)
- `z.string().refine(async ...)` requires `safeParseAsync` (the pipe already uses async parse).
- Metadata now lives on `.meta({ ... })` instead of `.describe(...)` / `.openapi(...)`.

### Step 2 — swap the package

```diff
{
  "dependencies": {
-   "nestjs-zod": "^x"
+   "zod-nest": "^0"
  }
}
```

### Step 3 — swap imports

```diff
- import {
-   createZodDto,
-   ZodValidationPipe,
-   ZodResponse,
-   cleanupOpenApiDoc,
- } from 'nestjs-zod';
+ import {
+   createZodDto,
+   ZodValidationPipe,
+   ZodResponse,
+   applyZodNest,
+ } from 'zod-nest';
```

`createZodDto`, `ZodValidationPipe`, and `ZodResponse` keep the same names — only the doc post-processor is renamed (`cleanupOpenApiDoc` → `applyZodNest`). If you're still on the older `@ZodSerializerDto + @ApiOkResponse` pattern (pre-`@ZodResponse`), see [Step 5](#step-5--rewrite-response-handlers) for the replacement.

### Step 4 — rewrite Swagger setup

```diff
  const raw = SwaggerModule.createDocument(app, config);
- const doc = cleanupOpenApiDoc(raw, { version: '3.1' });
+ const doc = applyZodNest(raw, { app });
  SwaggerModule.setup('docs', app, doc);
```

`applyZodNest` always emits OpenAPI 3.1 — there's no version flag. The `{ app }` argument is required (used to walk controllers via `DiscoveryService` for output-side DTO discovery).

If you served OpenAPI 3.0 from `nestjs-zod`, you'll need a downgrade pass *after* `applyZodNest`. There are good standalone tools (e.g. `openapi-down-convert`) for this.

### Step 5 — rewrite response handlers

Most projects are already on `@ZodResponse`. The decorator keeps the same name and `{ status?, type, description? }` shape — only the import source changes:

```diff
  @Get(':id')
  @ZodResponse({ type: UserDto })
  getUser(): Promise<UserDto> { /* ... */ }
```

(No diff inside the body — that's the point. Just verify the `ZodResponse` import resolves to `zod-nest` after Step 3.)

If you're still on the older `@ZodSerializerDto + @ApiOkResponse` pair (pre-`@ZodResponse`), collapse them:

```diff
  @Get(':id')
- @ApiOkResponse({ type: UserDto })
- @ZodSerializerDto(UserDto)
+ @ZodResponse({ type: UserDto })
  getUser(): Promise<UserDto> { /* ... */ }
```

For multi-status, stack `@ZodResponse` — a capability nestjs-zod's `@ZodResponse` didn't have (it validated type consistency at decoration time, blocking duplicates):

```diff
  @Get(':id')
  @ZodResponse({ type: UserDto })                      // success — 200 inferred
- @ApiNotFoundResponse({ type: ErrorDto })
+ @ZodResponse({ status: 404, type: ErrorDto })
  getUser(): unknown { /* ... */ }
```

The success variant can omit `status` — the precedence chain (`@HttpCode` → method default) handles it. Set `status` explicitly only on off-happy-path variants.

**Non-default response statuses — add `@HttpCode(...)` to keep the same behaviour.** `nestjs-zod`'s `@ZodResponse` was a composite — it applied `@HttpCode(status)` for you under the hood. `zod-nest`'s `@ZodResponse({ status: X })` only declares the variant (for the OpenAPI doc and for picking the validation schema at runtime); it does **not** set the actual HTTP response status. If your handler relied on the implicit `@HttpCode`, add an explicit one:

```diff
  @Post('queue')
+ @HttpCode(HttpStatus.ACCEPTED)                                       // <- sets actual response status to 202
  @ZodResponse({ status: HttpStatus.ACCEPTED, type: QueuedJobDto })   // <- matches that status for validation + doc
  queue() { /* ... */ }
```

Without the `@HttpCode(...)`, NestJS returns the method default (`201` for POST, `200` for everything else) and the `@ZodResponse({ status: 202 })` variant never matches — your response goes out unvalidated. **Rule of thumb during migration: every `@ZodResponse({ status: X, ... })` whose `X` differs from the method default needs a matching `@HttpCode(X)` next to it.**

Statuses set by *thrown* exceptions (e.g. `throw new NotFoundException()` → 404) don't need `@HttpCode` — Nest's exception filter sets the response status itself, and `@ZodResponse({ status: 404, ... })` matches against the resolved status at request time.

### Step 6 — register `ZodNestModule.forRoot()` (recommended)

`forRoot()` is optional but it's the easiest way to wire global pipe + interceptor + logging in one call:

```ts
@Module({
  imports: [
    ZodNestModule.forRoot({
      validationLogs: { output: true },         // log response-validation failures
      redactKeys: ['password', 'sessionId'],    // replaces default list, no merge
    }),
  ],
})
class AppModule {}
```

If you prefer manual wiring (e.g. you already had `APP_PIPE` and `APP_INTERCEPTOR` providers from `nestjs-zod`), swap the class:

```diff
- { provide: APP_PIPE,        useClass: ZodValidationPipe },
- { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
+ { provide: APP_PIPE,        useClass: ZodValidationPipe },          // same symbol
+ { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },   // same symbol
```

The class names are identical to `nestjs-zod`'s. They just come from a different package now.

### Step 7 — fix reflections + `.Output` consumers

If your code reads `MyDto.isZodDto`:

```diff
- if (Dto.isZodDto) { /* ... */ }
+ if (Symbol.for('zod-nest.dto') in Dto) { /* ... */ }
+ // or use the exported predicate:
+ import { isZodDto } from 'zod-nest';
+ if (isZodDto(Dto)) { /* ... */ }
```

If your code references `MyDto.Output` (a separate output class that always existed in `nestjs-zod`):

```diff
- type Out = z.infer<typeof MyDto.Output.schema>;
+ // Output sibling exists only when input/output diverge;
+ // for non-divergent schemas, MyDto.Output === MyDto in effect.
+ type Out = z.output<typeof MyDto.schema>;        // canonical Zod-level type
```

The `Output` sibling class still exists for the cases where input/output diverge, but for type-level work on a single schema, prefer `z.output<typeof schema>` — it's stable regardless of suffix behaviour.

### Step 8 — verify the migration

Run your project's typecheck and test suite. zod-nest-specific gotchas to watch for:

- **Stale `nestjs-zod` imports** that the find-and-replace missed.
- **Tests asserting on the 500 response body** containing an `errors` field — that field is gone (see [Serialization exception body changes](#serialization-exception-body-changes)).
- **Reflections on `MyDto.isZodDto`** — replace with the new discriminator (see Step 7).
- **Code reading `MyDto.Output.schema`** as a separate sibling — `.Output` only exists when input/output diverge; prefer `z.output<typeof schema>` for type-level work.

## What stays the same

- `createZodDto(schema, options?)` signature is unchanged.
- `ZodValidationPipe` global registration as `APP_PIPE` still works.
- DTO classes are still classes (`instanceof` works for interceptors / guards).
- Zod-level composition (`pick`, `omit`, `partial`, `extend`) still composes schemas the same way.
- `safeParseAsync` is used for input validation — async refinements work without extra wiring.

## New features available after migration

- **Multi-status response stacking** — multiple `@ZodResponse` decorators per handler, validated per-status.
- **HTTP-method-aware default status** — POST → 201, others → 200, layered under `@HttpCode`.
- **Customizable serialization exception** — the output side now has a factory hook, not just the input side.
- **Validation logging** — opt-in, per-side, with redaction + truncation. See [`docs/logging.md`](docs/logging.md).
- **Doc-build error detection** — `ZodNestDocumentError` fails fast on `AMBIGUOUS_RENAME` and `DANGLING_REF` instead of letting invalid specs ship.
- **I/O suffix only when needed** — single `User` entry collapses input + output when their JSON Schemas are byte-equal; splits to `User` + `UserOutput` only on divergence.
- **Schema metadata for Swagger UI** — `title`, `description`, `examples`, `deprecated` on `.meta({ ... })` flow through to Swagger UI rendering.
- **Composition layer (experimental)** — `extend(Parent, builder)` + `getLineage(schema)` emit OpenAPI `allOf`. See [`docs/composition.md`](docs/composition.md).
- **Custom emission overrides** — `overrideJSONSchema(schema, fragment)` for per-instance registration, plus a `zod-nest/helpers` subpath shipping common JSON Schema fragments (`binaryFragment`, `uuidFragment`, …), typed sugar (`binary`, `opaque`), type-strict `enrich(...)`, and ready-to-drop presets (`FileSchema`, `BlobSchema`, `BufferSchema`). Per-call `Override` callback on `applyZodNest` for the per-emission escape hatch.

## Serialization exception body changes

The default response body of `ZodSerializationException` (HTTP 500) **no longer includes the `errors` field**. A serialization failure is a server-side contract violation; exposing the zod error tree to clients discloses internal schema structure.

```diff
  // Old (nestjs-zod) — leaked the error tree:
  {
    "statusCode": 500,
    "message": "Internal Server Error",
-   "errors": { /* z.treeifyError(zodError) */ }
  }

  // New (zod-nest) — opaque:
  {
    "statusCode": 500,
    "message": "Response validation failed"
  }
```

The full treeified error still goes through `ZodNestModule`'s validation log channel (with redaction and truncation), and `err.zodError` remains accessible on the exception instance for custom filters. The error is visible to operators, opaque to clients.

`ZodValidationException` (HTTP 400) is unchanged — client-side errors stay detailed.

If you had a client relying on the 500 body's `errors` field for diagnostics, switch to log-based observability or supply a custom `createSerializationException` factory. See [`docs/exceptions.md`](docs/exceptions.md#why-the-response-body-has-no-errors-field).

## Worked example

Before — a `nestjs-zod` handler. The 404 variant has to live as a separate `@ApiNotFoundResponse` because `nestjs-zod`'s `@ZodResponse` doesn't stack:

```ts
import { createZodDto, ZodResponse, cleanupOpenApiDoc } from 'nestjs-zod';
import { ApiNotFoundResponse } from '@nestjs/swagger';
import { z } from 'zod';

class UserDto  extends createZodDto(z.object({ id: z.string().uuid(), name: z.string() })) {}
class ErrorDto extends createZodDto(z.object({ code: z.number(), message: z.string() })) {}

@Controller('users')
class UsersController {
  @Get(':id')
  @ZodResponse({ type: UserDto })
  @ApiNotFoundResponse({ type: ErrorDto })                  // doc-only, not validated
  async getUser(@Param('id') id: string): Promise<UserDto> { /* ... */ }
}

// main.ts
const raw = SwaggerModule.createDocument(app, config);
const doc = cleanupOpenApiDoc(raw, { version: '3.1' });
SwaggerModule.setup('docs', app, doc);
```

After — same handler with `zod-nest`. The 404 variant becomes a real validated `@ZodResponse`:

```ts
import { createZodDto, ZodResponse, applyZodNest } from 'zod-nest';
import { z } from 'zod';

const userSchema  = z.object({ id: z.uuid(), name: z.string() }).meta({ id: 'User' });
const errorSchema = z.object({ code: z.number(), message: z.string() }).meta({ id: 'Error' });

class UserDto  extends createZodDto(userSchema)  {}
class ErrorDto extends createZodDto(errorSchema) {}

@Controller('users')
class UsersController {
  @Get(':id')
  @ZodResponse({              type: UserDto })            // 200 inferred
  @ZodResponse({ status: 404, type: ErrorDto })           // validated, not just declared
  async getUser(@Param('id') id: string): Promise<UserDto> { /* ... */ }
}

// main.ts
const raw = SwaggerModule.createDocument(app, config);
const doc = applyZodNest(raw, { app });
SwaggerModule.setup('docs', app, doc);
```

The visible diff is small — most lines stay. The behavioural diff is significant: the 404 variant now validates the exception body against `ErrorDto` instead of just declaring it for the doc; the OpenAPI doc emits as 3.1 without the `cleanupOpenApiDoc` ritual; and on top of all that, every input/output failure can be opted into structured logging through `ZodNestModule.forRoot({ validationLogs: true })`.

## FAQ / troubleshooting

**"I get `MyDto.isZodDto` undefined after the swap."**
The discriminator is now `Symbol.for('zod-nest.dto') in MyDto`, or use the exported `isZodDto(value)` predicate. Search for any `.isZodDto` access in your codebase.

**"My `_Output` suffix vanished from the OpenAPI doc."**
Intentional. The output entry is only emitted when input and output JSON Schemas actually differ. If your schema is byte-identical on both sides (no `transform`, no `default`, no `pipe`), the doc collapses to a single entry. To force the split, give input and output schemas distinct ids. See [`docs/recipes/shared-input-output-schema.md`](docs/recipes/shared-input-output-schema.md).

**"My 500 responses no longer include the `errors` field."**
Intentional (and a security improvement) — see [Serialization exception body changes](#serialization-exception-body-changes) above. Move client-side diagnostics to log-based observability or a custom factory.

**"After migration, my response shapes are gone from the OpenAPI doc — `responses.<status>` is empty even though `@ZodResponse({ type })` is on the handler."**
Fixed since `zod-nest@1.4.0`. `@ZodResponse` is now a composite decorator: it applies the equivalent `@ApiResponse(...)` automatically, so the doc carries the response shape without a manual `@ApiResponse` next to it. If you're on an earlier `zod-nest` version, either upgrade or pair every `@ZodResponse({ type })` with `@ApiResponse({ status, type })`. See [`docs/responses.md → "OpenAPI emission"`](docs/responses.md#openapi-emission). For binary downloads where you previously hand-wrote `@ApiOkResponse({ content: { 'application/octet-stream' } })`: register the binary fragment via `overrideJSONSchema(BlobSchema, { type: 'string', format: 'binary' })` once, then use `@ZodResponse({ type: BlobDto })` — see [`docs/recipes/binary-downloads.md`](docs/recipes/binary-downloads.md).

**"I get `ZodNestDocumentError: DANGLING_REF` at boot."**
`applyZodNest` validates the final `$ref` graph. A dangling ref means a DTO is referenced from the doc but the registry doesn't know about it — typically a typo'd `.meta({ id })`, two `ZodNestRegistry` instances being used in the same app, or a user-supplied pre-pass that injected a ref to a non-existent component. The error message lists every offending ref with a hint from the collected-usage table. Schemas used only as `extend()` parents auto-register since 1.6 (`extend()` calls `registerSchema` on parent + result); for other named-but-DTO-less references, register the schema directly with `registerSchema(schema)` or wrap it in `createZodDto`.

**"After migration, my `@Query()` DTOs emit a single bogus `x-zod-nest-dto` parameter instead of one parameter per field."**
You're seeing the unprocessed marker from `@nestjs/swagger`'s `_OPENAPI_METADATA_FACTORY` explosion. `applyZodNest` has to run on the doc to split it into per-field parameters — confirm Step 4 wired `applyZodNest(rawDoc, { app })` between `SwaggerModule.createDocument(...)` and `SwaggerModule.setup(...)`. The expansion is symmetric with `nestjs-zod`'s `cleanupOpenApiDoc` (same field-per-parameter output) and covers `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` uniformly. See [`docs/recipes/query-param-dtos.md`](docs/recipes/query-param-dtos.md).

**"I get `ZodNestDocumentError: UNEXPANDABLE_PARAM_DTO` at boot."**
A `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` argument is bound to a `createZodDto` whose underlying schema isn't an object — typically `createZodDto(z.array(...))` or `createZodDto(z.union(...))`. The expansion has no top-level `properties` record to walk, so it bails out. Use `@Body()` for non-object DTOs, or restructure the schema as an object whose fields become the parameters. See [`docs/swagger-integration.md → UNEXPANDABLE_PARAM_DTO`](docs/swagger-integration.md#unexpandable_param_dto).

**"My emitted doc says `openapi: '3.0.0'` even though zod-nest claims 3.1-only output."**
Fixed in `applyZodNest` — it now writes `openapi: '3.1.0'` as its final step, regardless of `DocumentBuilder.setOpenAPIVersion(...)`. If you're still seeing `3.0.0`, double-check that the doc you're inspecting is the post-`applyZodNest` document (not the raw output from `SwaggerModule.createDocument`).

**"I get `ZodNestUnrepresentableError` for my `z.instanceof(File)` / `z.custom<T>()` field."**
JSON Schema can't represent `z.custom` / `z.instanceof` shapes — Zod emits `{}` and the engine throws in strict mode. For the common cases (`File` / `Blob` / `Buffer`) drop in the shipped presets:

```ts
import { FileSchema } from 'zod-nest/helpers';
class UploadDto extends createZodDto(z.object({ file: FileSchema })) {}
```

For everything else, register a JSON Schema fragment yourself using the `zod-nest/helpers` catalog so you don't have to hand-write the magic objects:

```ts
import { overrideJSONSchema } from 'zod-nest';
import { binary, uuidFragment } from 'zod-nest/helpers';

const PdfUpload = overrideJSONSchema(z.instanceof(File), binary({ contentMediaType: 'application/pdf' }));
const UserId = overrideJSONSchema(z.custom<string>(), uuidFragment);
```

For coercion shapes where the request and response sides need different fragments, pass `{ input, output }` instead of a raw fragment (additive overload, non-breaking). See [`docs/recipes/custom-openapi-overrides.md`](docs/recipes/custom-openapi-overrides.md) for the full helpers catalog and the I/O divergence pattern.

**"My async validation refinements don't fire."**
The pipe uses `safeParseAsync`, so async refinements work. Check that the schema is actually attached — `@Body() body: UserDto` (where `UserDto` is a `createZodDto` class) is the canonical wiring.

**"Cycle errors when emitting recursive schemas."**
Set `cycles: 'ref'` in the schema's `.meta(...)` (Zod v4 picks it up) and ensure the schema has an `id` (`.meta({ id: 'Comment' })`). See [`docs/recipes/recursive-schemas.md`](docs/recipes/recursive-schemas.md).

**"What happened to `createZodGuard` / `validate()` helpers?"**
Dropped. Use `schema.parse(input)` / `schema.safeParse(input)` directly — they're Zod's own API and work the same way as the previous helpers.

**"Can I use `class-validator` decorators on a `zod-nest` DTO?"**
No. The DTO class returned by `createZodDto` is Zod-native. If you have legacy DTOs using `class-validator`, leave them as plain `@nestjs/swagger`-decorated classes; `zod-nest` doesn't touch them. Hybrid projects work as long as each DTO sticks to one library.

**"`npm install zod-nest` errors with `ERESOLVE … reflect-metadata`."**
Your app is on NestJS 10. `zod-nest >=0.13.0` declares `@nestjs/common >=11`; NestJS 10 pinned `reflect-metadata@^0.1.x`, which can't coexist with the `reflect-metadata >=0.2.0` peer this library now requires. Upgrade your NestJS to 11.x, or stay on `zod-nest@<0.13.0`.

For anything not covered here, file an issue at <https://github.com/rodrigowbazevedo/zod-nest/issues> with the smallest reproduction you can build.
