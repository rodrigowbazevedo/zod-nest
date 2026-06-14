# Responses (`@ZodResponse` + `ZodSerializerInterceptor`)

`@ZodResponse` is a stackable method decorator that declares one or more typed response variants per handler. `ZodSerializerInterceptor` reads those variants at request time and validates the handler's return value against the variant whose status matches the actual response status code.

```ts
@Get(':id')
@ZodResponse({ type: UserDto })
getUser(): UserDto {
  return { id: 'u1', name: 'Ada' };
}
```

## The `type` argument

Each slot in `@ZodResponse({ type })` is an **entry** — either a `ZodDto` (from `createZodDto`) or a **raw Zod schema**. The slot shapes are discriminated at decoration time, not at request time:

| `type` shape               | Variant kind | Runtime validation                                         |
| -------------------------- | ------------ | ---------------------------------------------------------- |
| `Entry`                    | `'single'`   | `entry.schema.safeParseAsync(value)`                       |
| `[Entry]` (length 1)       | `'array'`    | `z.array(entry.schema).safeParseAsync(value)`              |
| `[A, B, ...]` (length ≥ 2) | `'tuple'`    | `z.tuple([A.schema, B.schema, ...]).safeParseAsync(value)` |

DTOs and raw schemas can be mixed within one array (`type: [UserDto, EventSchema]`). Empty arrays (`[]`) and entries that are neither a DTO nor a schema throw `TypeError` at decoration time — typos surface at module load, not the first request:

```ts
@ZodResponse({ type: [] })            // throws: "provide at least one DTO or schema"
@ZodResponse({ type: [NotADto] })     // throws: "element [0] must be a zod-nest DTO class …"
```

The wrapped Zod schema (array / tuple) is built **once at decoration time** and stored on the variant record. There is no per-request schema construction.

### Passing a raw schema

A request body must be a DTO — `ZodValidationPipe` constructs it (`new Dto()`) to bind the parsed value. A **response** body is output-only, so the schema alone is enough. Pass it directly:

```ts
const EventSchema = z
  .discriminatedUnion('event', [
    z.object({ event: z.literal('progress'), pct: z.number() }),
    z.object({ event: z.literal('done'), id: z.string() }),
  ])
  .meta({ id: 'Event' }); // ← names the OpenAPI component

@Get('stream')
@ZodResponse({ type: EventSchema, contentType: 'text/event-stream' })
events() {}
```

Internally a raw schema is normalised to `createZodDto(schema).Output` — **output IO**, because the response body is the schema's output. Everything downstream (component registration, `$ref` rewriting, multi-status stacking) works exactly as it does for a DTO.

**Why this exists.** `createZodDto` can't wrap a `z.discriminatedUnion` / `z.union` / `z.intersection` (or any schema whose `z.infer` is a union): `class Dto extends createZodDto(schema) {}` fails to compile with **TS2509** ("Base constructor return type … is not an object type"). Before, the workaround was `registerSchema(schema)` plus a hand-written `@ApiResponse({ content: { … { schema: { $ref: '#/components/schemas/Event' } } } })`. Now the schema goes straight into `@ZodResponse`.

**Named vs. anonymous.** With a `.meta({ id })`, the schema becomes a named `components.schemas` entry and the response references it by `$ref`. **Without an id, the schema is inlined directly into the response body** — `applyZodNest` renders the body at the use site and emits no synthetic component (so there is no `_Anon…` entry and no warning). Named schemas referenced *inside* an inlined anonymous body (e.g. the members of an anonymous `z.union([A, B])` where `A`/`B` have ids) stay as `$ref`s and remain in `components.schemas`. Reusing the **same anonymous instance** across routes duplicates the inlined body at each site — add `.meta({ id })` to share it as one named component instead. This mirrors how `@ZodBody` treats anonymous request bodies.

## Multi-status stacking

Stack multiple `@ZodResponse` decorators to declare different DTOs per status code:

```ts
class UserDto extends createZodDto(z.object({ id: z.string() }), { id: 'User' }) {}
class ErrorDto extends createZodDto(z.object({ code: z.number() }), { id: 'Error' }) {}
class FatalDto extends createZodDto(z.object({ trace: z.string() }), { id: 'Fatal' }) {}

class Controller {
  @Get(':id')
  @ZodResponse({ type: UserDto }) // success — 200 inferred
  @ZodResponse({ status: HttpStatus.NOT_FOUND, type: ErrorDto })
  @ZodResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, type: FatalDto })
  getUser(): void {}
}
```

**Recommended style:** omit `status` for the success variant (let the precedence chain infer it from the route) and set `status` explicitly only for the off-happy-path variants. The numbers you can see are the ones that aren't already encoded in the route. This is a style preference, not a correctness rule — an explicit `status: 200` works identically.

At request time, `ZodSerializerInterceptor` looks at `response.statusCode` and finds the variant where `resolveEffectiveStatus(variant, handler) === statusCode`. The matching variant's `validationSchema` is then applied to the return value.

**Author-order preservation.** TypeScript decorators apply bottom-up, but `appendResponseVariant` prepends, so the runtime metadata array reads in source order — `[OK, NOT_FOUND, INTERNAL_SERVER_ERROR]` for the snippet above. This matters for `@nestjs/swagger`, which iterates the variants when building `responses` entries.

## Status resolution precedence

`@ZodResponse` does **not** call `@HttpCode` under the hood. The HTTP status the client sees is whatever NestJS resolves — `@HttpCode(n)` on the handler, the method default, or a thrown exception. `@ZodResponse({ status })` only affects which **variant** is matched against that status.

The precedence chain when computing `resolveEffectiveStatus(variant, handler)`:

1. **Explicit `@ZodResponse({ status })`** — wins outright.
2. **`@HttpCode(n)` on the handler** — read via `Reflect.getMetadata(HTTP_CODE_METADATA, handler)`.
3. **HTTP method default** — `POST` → `201`, everything else → `200`.

```ts
@Post()
@HttpCode(HttpStatus.NO_CONTENT)
@ZodResponse({ type: NoneDto })                      // variant.status = undefined
foo() {}
// effective status = 204 (from @HttpCode)

@Post()
@HttpCode(HttpStatus.NO_CONTENT)
@ZodResponse({ status: HttpStatus.I_AM_A_TEAPOT, type: TeapotDto })
bar() {}
// effective status = 418 (explicit wins over @HttpCode)
```

This is why `@ZodResponse` works for arbitrary statuses without conflicting with `@HttpCode`: the caller owns the HTTP status via standard NestJS decorators, and `@ZodResponse` just maps it to a validation schema.

Resolution is **deferred to request time** because `@ZodResponse` runs before NestJS' route + `@HttpCode` decorators (TypeScript decorators apply bottom-up), so the method metadata isn't set yet at decoration time. The variant record stores `status: undefined` and `resolveEffectiveStatus(variant, handler)` is called per request.

## Status wildcards

`@ZodResponse({ status })` accepts the OpenAPI 3.1 range keys and the `'default'` sentinel in addition to numeric codes:

| `status` value                                  | Meaning                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `200`, `201`, `404`, …                          | Exact numeric match against `response.statusCode`.                                                                                                                                         |
| `'1XX'` / `'2XX'` / `'3XX'` / `'4XX'` / `'5XX'` | Matches any status in that hundreds bucket (`'2XX'` → 200–299).                                                                                                                            |
| `'default'`                                     | Sugar for the handler's resolved default status. Collapsed to `undefined` on the variant; resolves at request time via the same `@HttpCode → method-default` chain as an omitted `status`. |

`ZodSerializerInterceptor` selects a variant in **two passes**:

1. **Exact numeric** — first variant where `resolveEffectiveStatus(variant, handler)` is a number equal to `response.statusCode`.
2. **`NXX` wildcard** — first variant whose wildcard covers the observed bucket.

Source order breaks ties within each pass.

```ts
class Controller {
  @Get(':id')
  @ZodResponse({ status: 204, type: NoContentDto }) // exact wins for 204
  @ZodResponse({ status: '2XX', type: GenericOkDto }) // catches 200, 201, 202, 299
  @ZodResponse({ status: '4XX', type: ErrorDto })
  @ZodResponse({ status: '5XX', type: FatalDto })
  getUser(): void {}
}
```

### Why `'default'` is not a catch-all

`'default'` deliberately does **not** implement "fallback for any unclaimed status." It is sugar for "the method's resolved default status" — identical in semantics to omitting `status`. Concretely:

```ts
@Post()
@HttpCode(204)
@ZodResponse({ status: 'default', type: AcceptedDto }) // → variant.status undefined; effective status 204
foo() {}
```

This matches what consumers already write in `@ApiResponse({ status: 'default' })` to name the canonical-success card explicitly, and avoids the surprise of an unrelated 503 silently validating against the `'default'` DTO. If a true unclaimed-status fallback is needed, it's an additive change for later.

### OpenAPI emission

`@ZodResponse` is a **composite decorator**: in addition to registering the runtime variant, it applies `@ApiResponse(...)` (or the array/tuple equivalent) so the OpenAPI document carries the response shape automatically. No need to write `@ApiResponse({ type })` alongside `@ZodResponse({ type })` — the response card is emitted for you.

| Variant kind                     | What the doc gets                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@ZodResponse({ type: Dto })`    | `responses.<status>.content['application/json'].schema = { $ref: '#/components/schemas/<Dto>' }` |
| `@ZodResponse({ type: [Dto] })`  | `{ type: 'array', items: { $ref: '...' } }`                                                      |
| `@ZodResponse({ type: [A, B] })` | `{ type: 'array', prefixItems: [{ $ref: A }, { $ref: B }], items: false }` (OpenAPI 3.1 tuple)   |
| Wildcard `status: '2XX'`         | emitted as `responses.2XX` per OpenAPI 3.1                                                       |

Tuple variants also apply `@ApiExtraModels(...slotDtos)` so each tuple-slot DTO is registered in `components.schemas`.

The `application/json` media-type key above is the default. Pass `contentType` (or declare a stream-typed `@Header('Content-Type', …)`) to emit the response under a different media type — see [Streaming responses](#streaming-responses-contenttype--stream).

### Decorator ordering & the microtask trick

TypeScript decorators apply **bottom-up**, so `@ZodResponse` — usually written above `@Get` / `@Post` / `@HttpCode` / `@Header` — runs its factory body _first_, before sibling decorators have written their metadata. That metadata (`HTTP_CODE_METADATA`, `METHOD_METADATA`, `HEADERS_METADATA`) is what `@ZodResponse` reads to resolve the effective response **status** (when `status` is omitted) and the effective **content type** (when `contentType` is omitted but a `@Header('Content-Type', …)` is present).

To make all of that readable, `@ZodResponse` **always defers** its `@ApiResponse(...)` application by one `queueMicrotask`. By the time the microtask runs, every sibling decorator has settled its metadata. `@nestjs/swagger`'s `SwaggerExplorer` reads response metadata at `SwaggerModule.createDocument(...)` time (app-bootstrap, long after all microtasks have flushed), so the deferred application always lands in time.

**When does this matter to you?** Almost never. Two edge cases:

1. **Custom wrappers** — if you build a decorator factory that wraps `@ZodResponse` and itself defers work past microtasks, the ordering can race. Workaround: pass `status` / `contentType` explicitly in the wrapper so nothing has to be inferred from siblings.
2. **Unit-testing decorators in isolation** — if you call `Reflect.getMetadata('swagger/apiResponse', handler)` synchronously after class definition, the metadata won't be there yet. `await new Promise((r) => setImmediate(r))` once before asserting; the microtask flushes during NestJS' own `app.init()` in integration tests.

```ts
// status + content type both resolved from siblings, after the microtask
@Get('events')
@Header('Content-Type', 'text/event-stream')   // sets HEADERS_METADATA later
@ZodResponse({ type: EventDto })                // runs first; resolves ct via microtask → text/event-stream
events() {}
```

## Streaming responses (`contentType` + `stream`)

Streamed and binary responses — Server-Sent Events (`text/event-stream`), newline-delimited JSON (`application/x-ndjson`), file downloads (`application/octet-stream`, `application/pdf`, `image/*`, …) — are written straight to the response buffer. There's no single body object to validate, and the OpenAPI media-type key must be the stream type, not `application/json`. Two options on `@ZodResponse` cover both needs:

| Option        | Default              | Effect                                                                                           |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `contentType` | `'application/json'` | The OpenAPI media-type key. A non-JSON type emits `content[<contentType>].schema = $ref`.        |
| `stream`      | `false` (inferred)   | When `true`, `ZodSerializerInterceptor` **skips validation** — the body passes through verbatim. |

The `type` DTO describes **one event / line / blob**, not the whole stream — exactly the shape you'd hand-write into `@ApiOkResponse({ content: { 'text/event-stream': { schema } } })`, now with the full `@ZodResponse` ergonomics (component registration, `$ref` rewriting, multi-status stacking).

```ts
@Sse('events')
@ZodResponse({ type: NotificationEvent, contentType: 'text/event-stream' })
streamEvents(): Observable<MessageEvent> {
  /* … */
}

@Get('export')
@Header('Content-Type', 'application/x-ndjson')
@ZodResponse({ type: ExportRow })          // contentType inferred from @Header
exportNdjson(): void {
  /* writes rows directly to res */
}
```

### How `stream` is inferred

When `stream` is omitted, it's derived from the effective content type (the explicit `contentType`, or a stream-typed `@Header('Content-Type', …)`):

- A **known stream content type** ⇒ `stream = true` (validation skipped).
- Anything else ⇒ `stream = false` (validated as usual).

The built-in stream set is [`DEFAULT_STREAM_CONTENT_TYPES`](module-options.md#streamcontenttypes): `text/event-stream`, `application/x-ndjson`, `application/octet-stream`, `application/pdf`, and the `image/*`, `audio/*`, `video/*` families. Extend it globally with [`ZodNestModuleOptions.streamContentTypes`](module-options.md#streamcontenttypes) (merged additively with the defaults).

Set `stream` explicitly to override the inference either way — e.g. `stream: false` on a `text/event-stream` endpoint to keep validating, or `stream: true` on a custom content type you haven't added to the module set.

For full SSE / NDJSON / binary patterns, see [`recipes/streaming-responses.md`](recipes/streaming-responses.md) and [`recipes/binary-downloads.md`](recipes/binary-downloads.md).

> **`@Header` vs. the OpenAPI media type.** A stream-typed `@Header('Content-Type', …)` drives **both** the documented media type and the validation skip. A `@Header` whose value isn't a known stream type (e.g. `text/csv`) is ignored for the media-type key — set `contentType` explicitly to document an off-list type. The runtime skip still honours a module-configured `streamContentTypes` entry regardless.

## `passthroughOnError`

Variants are strict by default — validation failure throws `ZodSerializationException` (HTTP 500). Set `passthroughOnError: true` to switch to soft mode:

```ts
@Get('proxied')
@ZodResponse({ type: ProxyDto, passthroughOnError: true })
proxied(): unknown {
  return { upstream: 'value', extra: ['raw', 'shape'] };
}
```

On soft-mode failure:

- The **original value** passes through to the response (not the validated/parsed value).
- The output logger is invoked at `warn` severity (not `error`) — see [`logging.md`](logging.md).
- `createSerializationException` is **not** called.

Use cases:

- Upstream-controlled response shapes you don't fully trust but don't want to break the request over.
- Migration from a service you're slowly bringing under contract — log the deviations, ship the response anyway.
- Backwards-compatibility windows during DTO changes.

The transformed shape (e.g. `email.toLowerCase()` from a `transform`) is **not** applied in soft mode, because the validation that produced the transformed value failed. You get the original input verbatim.

## Per-variant soft + strict mix

`passthroughOnError` is per-variant, so you can mix strict and soft on the same handler:

```ts
class Controller {
  @Get(':id')
  @ZodResponse({ type: UserDto }) // strict, success (200 inferred)
  @ZodResponse({ status: 500, type: FatalDto, passthroughOnError: true }) // soft
  getUser(): void {}
}
```

This pattern is useful when the 5xx path is for a downstream you can't fully control — your 200 stays under contract, the 500 logs deviations but ships.

## Custom serialization exception

The factory thrown by strict-mode failures is set at module scope only:

```ts
ZodNestModule.forRoot({
  createSerializationException: (zodError, executionContext) =>
    new MyContractException(zodError, executionContext.switchToHttp().getRequest()),
});
```

No per-decorator or per-handler override — strict-mode failures are a global concern. The factory receives the `ExecutionContext` so you can walk back to the request, the handler class, or the controller for correlation ids and request-bound metadata.

Soft-mode variants never invoke this factory.

## Default response body

`ZodSerializationException` is HTTP 500 with body:

```ts
{
  statusCode: 500,
  message: 'Response validation failed',
}
```

The zod error tree is **deliberately not in the response body** — a serialization failure is a server-side contract violation, so the response stays opaque to clients. The full treeified error is logged via [`validation logging`](logging.md) (with redaction + truncation) and is also available on the thrown exception via `error.zodError` for custom exception filters. See [`exceptions.md`](exceptions.md#why-the-response-body-has-no-errors-field) for the policy and the introspection surface.

## When the interceptor is silent

`ZodSerializerInterceptor` is a no-op when:

- The execution context isn't HTTP (`context.getType() !== 'http'`) — RPC and WebSocket routes pass through.
- The handler has no `@ZodResponse` metadata.
- `response.statusCode` is `undefined` (rare — the response object hasn't been touched yet).
- No variant matches the observed status (e.g. handler returns 204 but you only declared `@ZodResponse({ status: 200 })`).

In the last case the original value passes through unchanged. The interceptor does not synthesize an empty body, throw a missing-variant error, or warn — the assumption is that the absent status is intentional (an exception-thrown path, a manually-set status the contract doesn't cover).

## Array and tuple responses

```ts
@Get('list')   @ZodResponse({ type: [UserDto] })          list(): UserDto[]
@Get('pair')  @ZodResponse({ type: [UserDto, TagDto] })  pair(): unknown
```

- `[Dto]` (length 1) → validates as `z.array(Dto.schema)`. OpenAPI shape: `type: array`, `items: { $ref: '...Dto' }`.
- `[A, B, ...]` (length ≥ 2) → validates as `z.tuple([A.schema, B.schema, ...])`. OpenAPI shape: `prefixItems: [...]` with explicit `minItems` / `maxItems`.

The validation matches the OpenAPI emission semantics — a 200-array response is `type: array`, a fixed-tuple response is `prefixItems`. No id minting for the array case (no `*sDto` ghost class).

## Reading variants programmatically

`getResponseVariants(handler)` returns the metadata array — useful for custom doc generators or alternative interceptors:

```ts
import { getResponseVariants, ZOD_RESPONSES_METADATA_KEY } from 'zod-nest';

const variants = getResponseVariants(UsersController.prototype.getUser);
// → [{ status: 200, kind: 'single', dto: UserDto, ... }, ...]
```

The metadata key is `Symbol.for('zod-nest.responses')` — cross-realm safe, so consumers in worker threads or vm contexts can read it via the same `Symbol.for` lookup.

## `resolveEffectiveStatus` and `defaultStatusFor`

Both are exported for use in custom interceptors or tests:

```ts
import { defaultStatusFor, resolveEffectiveStatus } from 'zod-nest';

defaultStatusFor(handler); // @HttpCode → method default
resolveEffectiveStatus(variant, handler); // variant.status → defaultStatusFor()
```

`defaultStatusFor` reads `HTTP_CODE_METADATA` and `METHOD_METADATA` from `@nestjs/common/constants`. If either constant is renamed in a future NestJS release, the assertions in the zod-nest test suite catch it loudly rather than letting `defaultStatusFor` silently return `200` for everything.
