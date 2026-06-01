# Input validation (`ZodValidationPipe`)

`ZodValidationPipe` validates request inputs (`@Body`, `@Query`, `@Param`, `@Headers`) against a Zod schema. It auto-detects the schema from the handler-arg metatype when that metatype is a zod-nest DTO, accepts an explicit DTO or raw Zod schema, and lets you override the exception factory at the pipe instance or at module scope.

## Constructor shapes

`new ZodValidationPipe(arg?)` discriminates its argument at runtime:

```ts
// 1. No argument — metatype-driven: reads the DTO from `argMetadata.metatype`.
new ZodValidationPipe();

// 2. A zod-nest DTO class — validates every value against `Dto.schema`.
new ZodValidationPipe(UserDto);

// 3. A bare Zod schema — same, but without an associated class.
new ZodValidationPipe(z.object({ id: z.string() }));

// 4. An options object — schema + per-pipe exception factory.
new ZodValidationPipe({
  schema: UserDto, // or a raw Zod schema
  createValidationException: (err, meta) => new MyError(),
});
```

The metatype-driven form (no argument) is the most common — wire the pipe globally and let it pick up whichever DTO each handler annotates:

```ts
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'zod-nest';

@Module({
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
class AppModule {}
```

Or via `ZodNestModule.forRoot()`, which also wires the response interceptor and logging in one call.

## Schema auto-detection

When no explicit schema or DTO is passed to the constructor, the pipe reads `argMetadata.metatype` on every `transform` call. If the metatype is a zod-nest DTO (has the `Symbol.for('zod-nest.dto')` tag), the pipe uses `Dto.schema`. If it isn't, the pipe is a no-op — the value passes through unchanged.

```ts
@Post()
create(@Body() body: UserDto) {     // metatype = UserDto → validated
  return body;
}

@Get()
list(@Query() q: { limit: number }) {  // metatype = Object → not validated
  return q;
}
```

This means a globally-registered `ZodValidationPipe` is safe — it only acts when the handler arg is typed as a zod-nest DTO. Plain `Object` / `number` / `string` metatypes are left alone.

## Failure flow

On `safeParseAsync` failure, the pipe:

1. Logs the failure if input logging is enabled (via `ZodNestModule.forRoot({ validationLogs: { input: true } })`). The log entry includes `side: 'input'`, the DTO label, `argType`, and the treeified Zod error. See [`logging.md`](logging.md).
2. Calls the exception factory and `throw`s the result.

```ts
// Default factory:
new ZodValidationException(zodError, argMetadata);

// HTTP 400, body:
{
  statusCode: 400,
  message: 'Validation failed',
  errors: z.treeifyError(zodError),
}
```

Logging fires **before** the throw. If you swallow the exception in a downstream filter, the log entry is still emitted.

## Custom exception factory

Three places to set the factory, in increasing precedence:

```ts
// Lowest — module default
ZodNestModule.forRoot({
  createValidationException: (err, meta) => new HttpException({ ... }, 422),
});

// Higher — per-pipe constructor option
new ZodValidationPipe({
  schema: UserDto,
  createValidationException: (err, meta) => new MyError(err),
});

// (no per-decorator override — input validation has no decorator-level shape)
```

The factory receives:

- `err: z.ZodError` — the original validation error, with `.issues` etc.
- `argMetadata: ArgumentMetadata` — `{ type, metatype, data }` from NestJS, telling you whether the failure was on `body`, `query`, `param`, or `custom`, and the inferred metatype.

Return anything `throw`-able. Typically a NestJS `HttpException` subclass so the rest of the framework (exception filters, response shaping) routes it correctly.

```ts
class UnprocessableEntityValidationException extends HttpException {
  constructor(public readonly zodError: z.ZodError) {
    super(
      { message: 'Validation failed', errors: z.treeifyError(zodError) },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

new ZodValidationPipe({
  schema: UserDto,
  createValidationException: (err) => new UnprocessableEntityValidationException(err),
});
```

## Async refinements

The pipe uses `safeParseAsync`, so schemas with `z.string().refine(async (v) => await checkUniqueness(v))` work without extra wiring. Synchronous schemas are just as supported — async only adds an overhead when the schema itself awaits.

Avoid network round-trips inside validation refinements when you can — schemas run on every request, and the validation budget is your latency floor.

## Empty inputs

A handler arg with no `metatype` (e.g. `@Query('q') q: string` extracting a primitive) leaves the pipe as a no-op. Validation kicks in only when the metatype is a zod-nest DTO class.

For empty bodies (`Content-Length: 0`), NestJS hands the pipe `{}` or `undefined`. Your schema needs to allow that explicitly — `z.object({}).strict()`, `z.unknown()`, or a `.optional()` wrapper. The pipe doesn't special-case empty input.

## Error introspection

The thrown `ZodValidationException` carries both `zodError` and `argMetadata` as own properties — useful for an exception filter that wants more than the default response body:

```ts
@Catch(ZodValidationException)
class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: ZodValidationException, host: ArgumentsHost) {
    const issues = exception.zodError.issues;
    const argType = exception.argMetadata?.type; // 'body' | 'query' | 'param' | 'custom'
    // route based on argType, log issues, format custom response, etc.
  }
}
```

See [`exceptions.md`](exceptions.md) for the full exception class surface.
