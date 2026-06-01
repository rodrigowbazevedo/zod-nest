# Recipe: Custom validation exception

Default behaviour: `ZodValidationPipe` throws `ZodValidationException` (HTTP 400, body `{ statusCode, message: 'Validation failed', errors: z.treeifyError(zodError) }`). When you need a different status, a different body shape, or want to attach correlation ids — supply a custom exception factory.

## Set it at module scope (one place, app-wide)

```ts
import { HttpException, HttpStatus, Module } from '@nestjs/common';
import { z } from 'zod';
import { ZodNestModule } from 'zod-nest';

class UnprocessableEntityValidationException extends HttpException {
  constructor(public readonly zodError: z.ZodError) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Request payload failed validation',
        errors: z.treeifyError(zodError),
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

@Module({
  imports: [
    ZodNestModule.forRoot({
      createValidationException: (err) => new UnprocessableEntityValidationException(err),
    }),
  ],
})
class AppModule {}
```

Every input validation failure throughout the app now produces 422 instead of 400, with your custom message envelope. The factory is invoked with `(err: z.ZodError, argMetadata: ArgumentMetadata)` — `argMetadata.type` tells you whether the failure came from `body`, `query`, `param`, or `custom`.

## Override at a specific pipe instance

```ts
import { ZodValidationPipe } from 'zod-nest';

@Post()
create(
  @Body(
    new ZodValidationPipe({
      schema: CreateUserDto,
      createValidationException: (err) =>
        new HttpException({ source: 'create-user', issues: err.issues }, 400),
    }),
  )
  body: CreateUserDto,
) {
  return body;
}
```

Per-instance overrides win over the module-scope factory. Useful when one route has a special error contract.

## Branch on `argMetadata.type`

```ts
ZodNestModule.forRoot({
  createValidationException: (err, meta) => {
    if (meta.type === 'query') {
      return new HttpException({ where: 'query-string', issues: err.issues.length }, 400);
    }
    if (meta.type === 'param') {
      return new HttpException({ where: 'path', issues: err.issues }, 404);
    }
    // Default — body / custom
    return new HttpException({ message: 'Validation failed', errors: z.treeifyError(err) }, 400);
  },
});
```

Mapping `param` failures to 404 is a common pattern — a malformed path segment usually means "not found" from the client's perspective.

## Carry correlation ids through the exception

```ts
class CorrelatedValidationException extends HttpException {
  constructor(
    zodError: z.ZodError,
    public readonly traceId: string,
  ) {
    super({ traceId, errors: z.treeifyError(zodError) }, HttpStatus.BAD_REQUEST);
  }
}

ZodNestModule.forRoot({
  createValidationException: (err, _meta) => {
    const traceId = getTraceIdFromAsyncContext();
    return new CorrelatedValidationException(err, traceId);
  },
});
```

The factory runs synchronously inside `ZodValidationPipe.transform`, so it has access to whatever async-local context your request middleware set up (e.g. AsyncLocalStorage, `cls-hooked`, `request-context`).

See [`docs/validation-pipe.md`](../validation-pipe.md) and [`docs/exceptions.md`](../exceptions.md) for the full surface.
