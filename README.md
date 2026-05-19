# zod-nest

> Modern **Zod v4** ↔ **NestJS** ↔ **OpenAPI 3.1** integration.

[![npm](https://img.shields.io/npm/v/zod-nest)](https://www.npmjs.com/package/zod-nest)
[![CI](https://github.com/rodrigowbazevedo/zod-nest/actions/workflows/ci.yml/badge.svg)](https://github.com/rodrigowbazevedo/zod-nest/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/rodrigowbazevedo/zod-nest/branch/main/graph/badge.svg)](https://codecov.io/gh/rodrigowbazevedo/zod-nest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Define your DTOs once with Zod, get validated request bodies, validated response bodies, and a correct OpenAPI 3.1 document — without the dual-codepath, post-process, or `@ts-ignore` baggage that comes with bolting Zod onto class-validator-shaped tooling.

## Why this exists

`zod-nest` is a fresh take on the idea pioneered by [`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) — many thanks to that project and its maintainers; this library would not exist without it.

The difference is that `zod-nest` is Zod v4 only and OpenAPI 3.1 only. It drops `class-validator` / `class-transformer` coexistence, drops Zod v3 codepaths, drops `cleanupOpenApiDoc` as a separate post-process, and drops the 20-odd `@ts-ignore`s that the dual-version approach required. The result is a smaller surface, fully type-safe end to end, with extension points where you actually need them — exception factories, response status resolution, custom emission overrides.

For the long-form motivation, see [`docs/why-this-exists.md`](docs/why-this-exists.md).

## Features

- **Zod v4 only** — no v3 dual codepath, no compatibility shim.
- **OpenAPI 3.1 emission** — no post-processing, no spec downgrade, no leftover internal extension keys.
- **`createZodDto`** — class wrapper around a Zod schema with introspectable `schema`, `id`, `io`, and a sibling `Output` class when input/output diverge.
- **`ZodValidationPipe`** — auto-detects DTO from handler-arg metatype, accepts an explicit DTO or raw Zod schema, customizable exception factory.
- **`@ZodResponse`** — stackable per status code, accepts a single DTO, an array (`[Dto]`), or a tuple (`[A, B, …]`). No internal `@HttpCode` — caller controls status.
- **`@ZodBody` / `@ZodQuery` / `@ZodHeaders` / `@ZodCookies`** — method-level decorators that wire OpenAPI docs for schemas whose `z.infer<>` is a union (intersection-of-union, discriminated unions, etc.) — the ones that can't be wrapped in `createZodDto` because TS refuses unions as class bases (TS2509). Schema validation stays via `@Body(new ZodValidationPipe(schema))`; the type at the handler arg stays `z.infer<>`.
- **`ZodSerializerInterceptor`** — response validation with a `passthroughOnError` escape hatch for untrusted upstream shapes.
- **`applyZodNest`** — one call after `SwaggerModule.createDocument(...)` replaces the entire `cleanupOpenApiDoc` ritual.
- **`ZodNestModule.forRoot`** — global pipe + interceptor + logging configuration in one place; optional (everything works standalone).
- **Validation logging** — opt-in, per-side (input/output), with case-insensitive deep-key redaction and oversize-value truncation.
- **Composition** — `extend` + `getLineage` emit OpenAPI `allOf` for derived schemas (`@experimental` — see [Composition](#composition-experimental)).
- **Custom registry support** — `createRegistry()` for explicit isolation, `defaultRegistry` for the common process-wide case.
- **Doc-build error reporting** — `ZodNestDocumentError` with codes `AMBIGUOUS_RENAME` and `DANGLING_REF` so registry mis-configurations fail in CI, not at runtime.
- **Strict-mode unrepresentable detection** — `ZodNestUnrepresentableError` surfaces bigint/date/transform constructs that JSON Schema can't represent (opt-out via `strict: false`).
- **Custom emission overrides** — `Override` callback for file uploads, opaque blobs, or anything else Zod doesn't model.

## Differences from `nestjs-zod`

A short list of behavioural differences you'll hit on day one. Full migration table is in [`MIGRATION.md`](MIGRATION.md).

- **Multi-status `@ZodResponse`** — stack the decorator per status code. In `nestjs-zod`, multi-status required mixing `@ZodSerializerDto` with hand-rolled `@ApiResponse({ status: ... })` calls.
- **No internal `@HttpCode`** — `@ZodResponse` does **not** call `@HttpCode` under the hood. Status resolution precedence: `@ZodResponse({ status })` → `@HttpCode(...)` on the handler → method default (`POST → 201`, others → `200`). The caller controls `201` vs `200` vs `204` via standard NestJS decorators. `status` accepts numeric codes plus the OpenAPI 3.1 range keys (`'1XX'`…`'5XX'`) and `'default'` (sugar for the resolved method default).
- **I/O suffix only when needed** — `<Id>Output` is only emitted when the input and output JSON Schemas actually differ. `nestjs-zod` always emitted `_Output`.
- **OpenAPI 3.1 only** — no `3.0` fallback. `$ref`s emit to the final location; `cleanupOpenApiDoc` is unnecessary.
- **Validation-failure logging out of the box** — `nestjs-zod` has none.
- **Customizable serialization exception** — both `ZodValidationPipe` and `ZodSerializerInterceptor` accept a factory. `nestjs-zod` only customized the input side.
- **DTO discriminator** — `Symbol.for('zod-nest.dto')` (cross-realm safe), not `MyDto.isZodDto`.
- **Codec mode in the schema** — express transforms via `z.pipe` / `z.transform`. No `{ codec: true }` flag.
- **Markers stripped** — the final document has zero `x-zod-nest-*` extensions. `nestjs-zod` left ~10 `x-nestjs_zod-*` keys behind.

## Non-goals (v0)

- **Zod v3 support** — Zod v4 only. Migrate first.
- **`class-validator` / `class-transformer` coexistence** — `zod-nest` is Zod-native. Mixing class-validator decorators on a `createZodDto` result is not supported.
- **Hybrid DTO projects** — mixing `createZodDto` DTOs with plain `@ApiProperty` classes in the same controller is not tested.
- **Non-HTTP contexts** — WebSocket gateways, GraphQL resolvers, microservice handlers are out of scope.

## Quickstart

```bash
npm i zod-nest zod @nestjs/swagger
```

```ts
// user.dto.ts
import { z } from 'zod';
import { createZodDto } from 'zod-nest';

const userSchema = z
  .object({
    id: z.string(),
    email: z.email().transform((v) => v.toLowerCase()),
  })
  .meta({ id: 'User' });

export class UserDto extends createZodDto(userSchema) {}
```

```ts
// users.controller.ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ZodResponse } from 'zod-nest';
import { UserDto } from './user.dto';

@Controller('users')
export class UsersController {
  @Get('single')
  @ZodResponse({ type: UserDto })
  single(): UserDto {
    return { id: 'u1', email: 'A@B.COM' } as UserDto; // transform lowercases on the way out
  }

  @Post()
  @ZodResponse({ type: UserDto })
  create(@Body() body: UserDto): UserDto {
    // body is already validated + parsed by ZodValidationPipe
    return body;
  }
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { ZodNestModule } from 'zod-nest';
import { UsersController } from './users.controller';

@Module({
  imports: [ZodNestModule.forRoot({ validationLogs: true })],
  controllers: [UsersController],
})
export class AppModule {}
```

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applyZodNest } from 'zod-nest';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const raw = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Users').setVersion('1').build(),
  );
  const doc = applyZodNest(raw, { app });
  SwaggerModule.setup('docs', app, doc);

  await app.listen(3000);
}

bootstrap();
```

That's the whole loop. Validation, response serialization, and a correct OpenAPI 3.1 document — all driven from one Zod schema per DTO.

## Core concepts

### Schema is the source of truth

Every DTO is one Zod schema wrapped in a class. The class exists so NestJS' introspection (parameter metatype, `@nestjs/swagger`) can find it; the validation and the OpenAPI emission both come from the schema directly. You don't repeat the shape with decorators.

### `createZodDto` is a thin bridge

The class returned by `createZodDto(schema)` carries `schema`, `id`, `io: 'input'`, and a lazy `Output` sibling. `parse` / `safeParse` are static methods on the class. The class is tagged with `Symbol.for('zod-nest.dto')` so `ZodValidationPipe` and `ZodSerializerInterceptor` can discriminate it from plain constructors. The id comes from `schema.meta({ id })` when present (preferred) or from the second-argument options.

See [`docs/dto.md`](docs/dto.md) for the full surface.

### Schemas that don't fit a class

A schema whose `z.infer<>` is a TypeScript union — `z.union`, `z.discriminatedUnion`, or `z.intersection(obj, union)` — can't be used as a class base because TS rejects unions as constructor return types (TS2509: *Base constructor return type ... is not an object type*). For these, skip `createZodDto` and pair the raw schema with parameter-level decorators that handle OpenAPI emission directly:

```ts
const IntersectionWithUnion = z
  .intersection(
    z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
    z.union([z.object({ c: z.string() }), z.object({ d: z.string() })]),
  )
  .meta({ id: 'IntersectionWithUnion' });

type IntersectionWithUnionType = z.infer<typeof IntersectionWithUnion>;

@Controller()
export class Controller {
  @Post()
  @ZodBody(IntersectionWithUnion)
  async post(
    @Body(new ZodValidationPipe(IntersectionWithUnion))
    body: IntersectionWithUnionType,
  ): Promise<IntersectionWithUnionType> {
    return body;
  }
}
```

The decorator set: `@ZodBody`, `@ZodQuery`, `@ZodHeaders`, `@ZodCookies`. All are method-level. They register the schema in the registry (so it lands in `components.schemas` when named) and apply the matching OpenAPI parameter metadata — `@ZodBody` writes the request body's `$ref`/inline schema; `@ZodQuery` / `@ZodHeaders` / `@ZodCookies` expand a `z.object` into one OpenAPI parameter per property. Validation stays manual via `@Body(new ZodValidationPipe(schema))` so the handler arg keeps its precise `z.infer<>` type.

See [`docs/recipes/intersection-with-union.md`](docs/recipes/intersection-with-union.md) for the full pattern.

### I/O suffix rules

If a schema's input and output JSON Schemas are byte-equal (the common case), the OpenAPI doc emits a single `components.schemas[Id]`. If they differ (e.g. a `transform`, a `pipe`, an `.optional().default(x)` field), the doc emits two: `Id` for input, `IdOutput` for output. Response refs are rewritten to `IdOutput` automatically.

You don't pick the behaviour with a flag — `applyZodNest` compares the emitted bodies and decides per DTO.

### Multi-status responses + status resolution

Stack `@ZodResponse` to declare multiple status codes on one handler:

```ts
@Get(':id')
@ZodResponse({ type: UserDto })                       // success variant — status inferred (200 for GET)
@ZodResponse({ status: 404, type: ErrorDto })
@ZodResponse({ status: 500, type: FatalDto })
getUser(): void {}
```

**Recommended style:** omit `status` for the success variant and let it infer from the route, then set `status` explicitly only for the off-happy-path variants. Keeps the signal-to-noise high — the explicit numbers in the snippet above are the ones the reader actually needs to scan for.

At request time, `ZodSerializerInterceptor` looks at `response.statusCode` and picks the matching variant. If you don't pass `status`, the variant matches on the handler's default (computed once at request time, in this order: `@HttpCode(n)` → `POST → 201`, everything else → `200`). `@ZodResponse` does **not** internally apply `@HttpCode` — you stay in charge of the actual HTTP status.

See [`docs/responses.md`](docs/responses.md) for the precedence chain and `passthroughOnError`.

## Usage

### Creating DTOs

```ts
import { z } from 'zod';
import { createZodDto } from 'zod-nest';

const userSchema = z.object({ id: z.uuid(), name: z.string() }).meta({ id: 'User' });
class UserDto extends createZodDto(userSchema) {}

UserDto.parse({ id: '00000000-0000-0000-0000-000000000000', name: 'Ada' });
// → { id: '...', name: 'Ada' }
```

### Setting the OpenAPI schema id

The id is what appears as the `components.schemas` key in the OpenAPI document and what `$ref`s point at. You can set it in two equivalent ways:

```ts
// Preferred — on the schema, via Zod's metadata
const userSchema = z.object({ /* ... */ }).meta({ id: 'User' });
class UserDto extends createZodDto(userSchema) {}

// Also valid — passed through createZodDto's options
class UserDto extends createZodDto(
  z.object({ /* ... */ }),
  { id: 'User' },
) {}
```

Both produce the same OpenAPI output. `.meta({ id })` is preferred when the schema is hoisted into its own `const`, because the id stays with the schema — composition (`extend(parent, ...)`), shared input/output via `.meta({ id })` on the same schema reference, and any non-DTO use of the schema all pick up the same id without an extra hop through `createZodDto`'s options. Use the `createZodDto(schema, { id })` form when you don't own the schema (e.g. it comes from a third-party module) or when defining a small DTO with an inline schema, where chaining `.meta()` on the inline expression hurts readability.

If you pass neither, the class name is used as a fallback. Under minification — where class names become single mangled characters — `zod-nest` falls back to an `_AnonZodDto_N` id and prints a one-time console warning. Set an explicit id either way for production builds.

### Input validation

```ts
import { ZodValidationPipe } from 'zod-nest';
import { APP_PIPE } from '@nestjs/core';

@Controller('things')
class ThingsController {
  @Post()
  create(@Body() body: CreateThingDto) {
    return { received: body };
  }
}

@Module({
  controllers: [ThingsController],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
class AppModule {}
```

Or use `ZodNestModule.forRoot()` — see [Module options](#module-options) below — to wire the pipe globally along with the response interceptor.

On failure the pipe throws `ZodValidationException` (HTTP 400, body `{ statusCode, message: 'Validation failed', errors: z.treeifyError(zodError) }`).

### Custom validation exception

```ts
import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodValidationPipe } from 'zod-nest';

class UnprocessableEntityException extends HttpException {
  constructor(issuesCount: number) {
    super({ message: 'invalid input', issuesCount }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

const pipe = new ZodValidationPipe({
  schema: CreateThingDto,
  createValidationException: (zodError) => new UnprocessableEntityException(zodError.issues.length),
});
```

The factory receives `(zodError, argMetadata)` and returns anything `throw`-able. Wire it module-wide via `ZodNestModule.forRoot({ createValidationException: ... })`.

### Single-status response

```ts
@Controller('users')
class UsersController {
  @Get('single')
  @ZodResponse({ type: UserDto })
  single(): UserDto {
    return { id: 'u1', email: 'A@B.COM' };
  }
}
```

The interceptor validates the return value against `UserDto.schema` and applies any `transform` / `pipe` Zod stages — in the example above, `email` is lowercased to `a@b.com` before the response leaves.

### Multi-status responses

Stack `@ZodResponse` per status code:

```ts
import { Get, HttpStatus } from '@nestjs/common';
import { ZodResponse } from 'zod-nest';

class UserDto  extends createZodDto(z.object({ id: z.string() }),    { id: 'User' })  {}
class ErrorDto extends createZodDto(z.object({ code: z.number() }),  { id: 'Error' }) {}
class FatalDto extends createZodDto(z.object({ trace: z.string() }), { id: 'Fatal' }) {}

class UsersController {
  @Get(':id')
  @ZodResponse({                                           type: UserDto })  // 200 inferred
  @ZodResponse({ status: HttpStatus.NOT_FOUND,             type: ErrorDto })
  @ZodResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, type: FatalDto })
  getUser(): void {}
}
```

At runtime the interceptor matches `response.statusCode` against each variant's `status`. The OpenAPI doc emits three `responses[200|404|500]` entries with the right DTO ref under each. See [`docs/responses.md`](docs/responses.md) for the full mechanism.

### `passthroughOnError`

For an upstream shape you don't fully trust, set `passthroughOnError: true` on the variant. Validation failures are logged (if logging is on) but the original value passes through untouched:

```ts
@Get('proxied')
@ZodResponse({ type: ProxyDto, passthroughOnError: true })
proxied(): unknown {
  return { upstream: 'value', extra: ['raw', 'shape'] };
}
```

Use this sparingly — it bypasses the contract you declared. Logging at `warn` severity makes the deviation visible without breaking the request.

### Array and tuple responses

```ts
@Get('list')   @ZodResponse({ type: [UserDto] })          list(): UserDto[] { /* ... */ }
@Get('pair')  @ZodResponse({ type: [UserDto, TagDto] })  pair(): unknown { /* ... */ }
```

`[Dto]` validates as `z.array(Dto.schema)` and surfaces as OpenAPI `type: array`. `[A, B, …]` validates as `z.tuple([A.schema, B.schema, …])` and surfaces as `prefixItems`. Empty arrays and non-DTO elements throw `TypeError` at decoration time, so typos surface at module load — not the first request.

### Swagger integration

```ts
import { applyZodNest } from 'zod-nest';

const raw = SwaggerModule.createDocument(app, config);
const doc = applyZodNest(raw, { app });
SwaggerModule.setup('docs', app, doc);
```

`applyZodNest` walks the doc, replaces every `x-zod-nest-dto` marker with the real Zod-derived JSON Schema, applies the I/O suffix truth table, strips the markers, and validates the final ref graph. Any dangling ref throws `ZodNestDocumentError({ code: 'DANGLING_REF' })` — the spec fails at boot, not at request time.

See [`docs/swagger-integration.md`](docs/swagger-integration.md) for `Override`, custom registries, and strict-mode behaviour.

### Module setup

```ts
import { ZodNestModule } from 'zod-nest';

@Module({
  imports: [
    ZodNestModule.forRoot({
      validationLogs: { input: true, output: true },
      redactKeys: ['password', 'token', 'sessionId'],
      createSerializationException: (err, ctx) =>
        new MyCustomFiveHundred(err, ctx),
    }),
  ],
  controllers: [UsersController],
})
class AppModule {}
```

`forRoot()` is optional — `ZodValidationPipe` and `ZodSerializerInterceptor` work standalone with safe defaults. Use `forRoot` when you want consistent logging, a custom logger, custom exceptions, or shared redaction across the pipe and the interceptor.

## Module options

| Option | Type | Default | What it does |
|---|---|---|---|
| `createValidationException` | `(err, argMetadata) => unknown` | uses `ZodValidationException` | Custom 400 exception for input failures |
| `createSerializationException` | `(err, executionContext) => unknown` | uses `ZodSerializationException` | Custom 500 exception for output failures (strict mode only) |
| `validationLogs` | `boolean \| { input?, output? }` | `false` | Opt-in failure-only logging |
| `logger` | `LoggerService` | NestJS `Logger` | Replace the logger (pino, winston, …) |
| `redactKeys` | `readonly string[]` | `DEFAULT_REDACT_KEYS` | Keys redacted in logs (replaces default list, no merge) |
| `maxLoggedValueBytes` | `number` | `4096` | Truncate oversize logged values |

`DEFAULT_REDACT_KEYS` includes `password`, `secret`, `apiKey`, `authorization`, `bearer`, `token`, `accessToken`, `refreshToken`, `jwt`, `cookie`, `set-cookie`. Matching is case-insensitive and applied at any depth in the logged value.

Full reference (with every interaction note) lives in [`docs/module-options.md`](docs/module-options.md).

## Logging

Validation logging fires **only on failure**, with side `'input'` or `'output'`. The default behaviour is off; opt in via `validationLogs: true` (both sides) or `validationLogs: { input: true }` / `{ output: true }` (granular).

A log entry carries:

- `side` — `'input'` or `'output'`
- `severity` — `'error'` for strict failures, `'warn'` for `passthroughOnError` failures
- `dto` — the DTO class name
- `value` — the offending value, redacted and truncated
- the treeified Zod error from `z.treeifyError(zodError)`

Redaction is **case-insensitive** at any depth — a key named `Password` deep in a nested object is replaced with `'[REDACTED]'` just like a top-level `password`. Truncation replaces values larger than `maxLoggedValueBytes` (UTF-8 bytes) with `{ _truncated: true, _originalBytes, _preview }` so you keep enough context to debug without flooding the logger.

Supplying `redactKeys` **replaces** the default list — there is no merge. If you want to *add* keys, spread `DEFAULT_REDACT_KEYS`:

```ts
import { DEFAULT_REDACT_KEYS, ZodNestModule } from 'zod-nest';

ZodNestModule.forRoot({
  validationLogs: true,
  redactKeys: [...DEFAULT_REDACT_KEYS, 'sessionId'],
});
```

See [`docs/logging.md`](docs/logging.md) for custom-logger adapters (pino, winston), structured-logging shape, and performance characteristics.

## Composition (experimental)

> **`@experimental`** — output shape may change as edge cases surface. Pin a minor version if you build on this surface.

`zod-nest` ships an `extend` helper that records a parent → child link and emits OpenAPI `allOf` for derived schemas:

```ts
import { extend, getLineage } from 'zod-nest';

const Base = z.object({ id: z.string() }).meta({ id: 'Base' });
const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Child' }));

getLineage(Child);
// → { op: 'extend', parent: Base }
```

The emitted `Child` schema is `allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { role: { type: 'string' } }, required: ['role'] }]`. The parent must be registered (via `.meta({ id })` or `createZodDto`) for the `$ref` to resolve; anonymous parents fall back to flat emission.

See [`docs/composition.md`](docs/composition.md) for the full contract, current limitations, and the roadmap for non-`extend` operators.

## API reference

A compact, link-out index. Type signatures and detailed semantics live in the companion docs.

**DTO** — [`docs/dto.md`](docs/dto.md)
- `createZodDto(schema, options?)`, `isZodDto(value)`, `ZodDto<TSchema>`, `Io`

**Validation** — [`docs/validation-pipe.md`](docs/validation-pipe.md)
- `ZodValidationPipe`, `ZodValidationException`, `ZodValidationPipeOptions`, `CreateValidationException`

**Response** — [`docs/responses.md`](docs/responses.md)
- `@ZodResponse({ status?, type, description?, passthroughOnError? })`, `ZodSerializerInterceptor`, `ZodSerializationException`, `defaultStatusFor`, `resolveEffectiveStatus`, `ResponseStatusInput`, `ResponseStatusWildcard`, `ResponseVariant`, `ZOD_RESPONSES_METADATA_KEY`

**Parameter decorators for raw schemas** — [`docs/recipes/intersection-with-union.md`](docs/recipes/intersection-with-union.md)
- `@ZodBody(schema, options?)`, `@ZodQuery(schema, options?)`, `@ZodHeaders(schema, options?)`, `@ZodCookies(schema, options?)`, `ZodBodyOptions`, `ZodQueryOptions`, `ZodHeadersOptions`, `ZodCookiesOptions`

**Document** — [`docs/swagger-integration.md`](docs/swagger-integration.md)
- `applyZodNest(rawDoc, options)`, `ApplyZodNestOptions`, `ZodNestDocumentError`

**Module** — [`docs/module-options.md`](docs/module-options.md) / [`docs/logging.md`](docs/logging.md)
- `ZodNestModule.forRoot(options?)`, `ZodNestModuleOptions`, `DEFAULT_REDACT_KEYS`, `DEFAULT_MAX_LOGGED_VALUE_BYTES`, `ZOD_NEST_OPTIONS`

**Schema engine** — single-schema mode and extension points
- `toOpenApi(schema, opts)`, `createRegistry()`, `defaultRegistry`, `registerSchema(schema, registry?, options?)`, `ZodNestRegistry`, `RegisterSchemaOptions`, `Override`, `OverrideContext`, `overrideJSONSchema(schema, fragment | { input?, output? })`, `OverrideJSONSchemaArg`, `ZodNestError`, `ZodNestUnrepresentableError`, `extend`, `getLineage`, `LineageEntry`

**Helpers** (subpath: `zod-nest/helpers`) — common JSON Schema fragments + presets for assembling overrides
- **Fragment catalog** (frozen consts): `dateTimeFragment`, `dateFragment`, `timeFragment`, `uuidFragment`, `emailFragment`, `uriFragment`, `hostnameFragment`, `ipv4Fragment`, `ipv6Fragment`, `binaryFragment`, `byteFragment`, `int32Fragment`, `int64Fragment`, `floatFragment`, `doubleFragment`, `opaqueFragment`
- **Sugar functions**: `binary(opts?)`, `opaque(opts?)`
- **Type-strict composition**: `enrich(base, extras)` — extras are typed per fragment family
- **Pre-registered Zod schemas**: `FileSchema`, `BlobSchema`, `BufferSchema` (all `z.instanceof(...)` + `binaryFragment`)

See [`docs/recipes/custom-openapi-overrides.md`](docs/recipes/custom-openapi-overrides.md) for the full catalog and usage patterns.

## Documentation

| Topic | Doc |
|---|---|
| Why this library exists | [`docs/why-this-exists.md`](docs/why-this-exists.md) |
| `createZodDto` in depth | [`docs/dto.md`](docs/dto.md) |
| Input validation | [`docs/validation-pipe.md`](docs/validation-pipe.md) |
| Responses, multi-status, status resolution | [`docs/responses.md`](docs/responses.md) |
| Module options reference | [`docs/module-options.md`](docs/module-options.md) |
| Validation logging | [`docs/logging.md`](docs/logging.md) |
| Swagger integration & custom emission | [`docs/swagger-integration.md`](docs/swagger-integration.md) |
| Composition (experimental) | [`docs/composition.md`](docs/composition.md) |
| Exception classes | [`docs/exceptions.md`](docs/exceptions.md) |
| Recipes | [`docs/recipes/`](docs/recipes/) |

## Compatibility matrix

`zod-nest` declares explicit min + max peer-dep ranges in `package.json`: `zod >=4.4.0 <5.0.0`, `@nestjs/common >=11.0.1 <12.0.0`, `@nestjs/core >=11.0.1 <12.0.0`, `@nestjs/swagger >=11.0.0 <12.0.0`, `rxjs >=7.6.0 <8.0.0`, `reflect-metadata >=0.2.0 <0.3.0`, Node `>=22`. CI validates those claims by running the full test suite against the cells below; a red cell is a real blocker. Upper bounds are deliberate — a new peer major has to land in a real PR with a `/check-upstream-updates` audit before consumers can install it against this library.

| Cell | `zod` | `@nestjs/common` | `@nestjs/core` | `@nestjs/swagger` | `rxjs` | `reflect-metadata` |
|---|---|---|---|---|---|---|
| `floor` | 4.4.0 | 11.0.1 | 11.0.1 | 11.0.0 | 7.6.0 | 0.2.0 |
| `zod-latest` | latest | 11.0.1 | 11.0.1 | 11.0.0 | 7.6.0 | 0.2.0 |
| `nest-latest` | 4.4.0 | latest | latest | latest | 7.6.0 | 0.2.0 |
| `rxjs-latest` | 4.4.0 | 11.0.1 | 11.0.1 | 11.0.0 | latest | 0.2.0 |
| `reflect-metadata-latest` | 4.4.0 | 11.0.1 | 11.0.1 | 11.0.0 | 7.6.0 | latest |
| `all-latest` | latest | latest | latest | latest | latest | latest |

Cell definitions live in [`.github/compat-matrix.json`](.github/compat-matrix.json). The CI workflow ([`.github/workflows/compat-matrix.yml`](.github/workflows/compat-matrix.yml)) runs on every push to `main` and weekly on Monday — when a cell fails, the workflow opens (or comments on) a GitHub issue labelled `compat-matrix-failure` so the regression is tracked outside the Actions UI. Editing the JSON is the formal way to extend or shrink supported ranges. Node is not matrixed — the `>=22` floor is enforced by `engines`.

## Migration from `nestjs-zod`

If you're coming from `nestjs-zod`, the headline changes are:

- Replace `cleanupOpenApiDoc(SwaggerModule.createDocument(app, config))` with `applyZodNest(SwaggerModule.createDocument(app, config), { app })`.
- Replace `@ApiOkResponse({ type: Dto }) + @ZodSerializerDto(Dto)` pairs with `@ZodResponse({ type: Dto })`.
- Drop `class-validator` / `class-transformer` if they were installed only for `nestjs-zod` interop.
- Check any `MyDto.isZodDto` reflection — the discriminator is now `Symbol.for('zod-nest.dto') in MyDto`.

Full guide with side-by-side diffs and a 19-row breaking-changes table in [`MIGRATION.md`](MIGRATION.md).

## AI tooling — `npx skills`

`zod-nest` ships two AI-agent skills you can install into your project via [`npx skills`](https://github.com/vercel-labs/skills) (Claude Code primary; Cursor / Continue best-effort):

- **`zod-nest-migrate`** — walks an agent through the 8-step `nestjs-zod` → `zod-nest` migration, plan-then-apply per step.
- **`zod-nest`** — diagnostic best-practices skill for schema and `@ZodResponse` ergonomics; auto-triggers on edits to `*.controller.ts` / `*.dto.ts` files that import from `zod-nest`.

```bash
npx skills add rodrigowbazevedo/zod-nest                                   # both skills
npx skills add rodrigowbazevedo/zod-nest --skill zod-nest-migrate          # migration only
npx skills add rodrigowbazevedo/zod-nest --skill zod-nest                  # best-practices only
```

Full details, agent compatibility notes, and what each skill diagnoses: [`docs/skills.md`](docs/skills.md).

## Contributing

`zod-nest` is a young, single-maintainer OSS project — contributions and issues are welcome. The codebase is well-tested (>340 tests, full coverage on document/schema layers) and is meant to stay small enough that a first-time contributor can hold the whole surface in their head.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for local-dev setup, the test layout, and how to add a recipe. Reports and discussions go through [GitHub issues](https://github.com/rodrigowbazevedo/zod-nest/issues).

## License

MIT — see [`LICENSE`](LICENSE).

The names and patterns `createZodDto`, `ZodValidationPipe`, `ZodValidationException`, `ZodSerializerInterceptor`, `ZodSerializationException`, and `ZodResponse` originate in [`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) (MIT). Attribution lives in [`NOTICE`](NOTICE).
