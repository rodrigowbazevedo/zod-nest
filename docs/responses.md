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

`@ZodResponse({ type })` accepts three shapes — discriminated at decoration time, not at request time:

| `type` shape | Variant kind | Runtime validation |
|---|---|---|
| `Dto` | `'single'` | `Dto.schema.safeParseAsync(value)` |
| `[Dto]` (length 1) | `'array'` | `z.array(Dto.schema).safeParseAsync(value)` |
| `[A, B, ...]` (length ≥ 2) | `'tuple'` | `z.tuple([A.schema, B.schema, ...]).safeParseAsync(value)` |

Empty arrays (`[]`) and non-DTO elements throw `TypeError` at decoration time — typos surface at module load, not the first request:

```ts
@ZodResponse({ type: [] })       // throws: "provide at least one DTO"
@ZodResponse({ type: [User] })   // throws: "element [0] is not a zod-nest DTO"
```

The wrapped Zod schema (array / tuple) is built **once at decoration time** and stored on the variant record. There is no per-request schema construction.

## Multi-status stacking

Stack multiple `@ZodResponse` decorators to declare different DTOs per status code:

```ts
class UserDto    extends createZodDto(z.object({ id: z.string() }),    { id: 'User' })  {}
class ErrorDto   extends createZodDto(z.object({ code: z.number() }),  { id: 'Error' }) {}
class FatalDto   extends createZodDto(z.object({ trace: z.string() }), { id: 'Fatal' }) {}

class Controller {
  @Get(':id')
  @ZodResponse({ status: HttpStatus.OK,                    type: UserDto })
  @ZodResponse({ status: HttpStatus.NOT_FOUND,             type: ErrorDto })
  @ZodResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, type: FatalDto })
  getUser(): void {}
}
```

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
  @ZodResponse({ status: 200, type: UserDto })                              // strict
  @ZodResponse({ status: 500, type: FatalDto, passthroughOnError: true })  // soft
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

defaultStatusFor(handler);             // @HttpCode → method default
resolveEffectiveStatus(variant, handler); // variant.status → defaultStatusFor()
```

`defaultStatusFor` reads `HTTP_CODE_METADATA` and `METHOD_METADATA` from `@nestjs/common/constants`. If either constant is renamed in a future NestJS release, the assertions in the zod-nest test suite catch it loudly rather than letting `defaultStatusFor` silently return `200` for everything.
