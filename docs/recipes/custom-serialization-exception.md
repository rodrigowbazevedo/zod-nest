# Recipe: Custom serialization exception

Default behaviour: `ZodSerializerInterceptor` in strict mode throws `ZodSerializationException` (HTTP 500, body `{ statusCode, message: 'Response validation failed' }` — the zod error tree is deliberately not in the body; see [the policy](../exceptions.md#why-the-response-body-has-no-errors-field)). Supply a custom factory to control how operators see the failure without changing what clients see.

## A factory that forwards to your error tracker

```ts
import { Module } from '@nestjs/common';
import type { ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { z } from 'zod';
import { ZodNestModule, ZodSerializationException } from 'zod-nest';

@Module({
  imports: [
    ZodNestModule.forRoot({
      validationLogs: { output: true },
      createSerializationException: (zodError, ctx) => {
        const req = ctx.switchToHttp().getRequest<{ url: string; traceId?: string }>();

        errorTracker.captureException(zodError, {
          tag: 'response-validation-failure',
          url: req.url,
          traceId: req.traceId,
          issues: zodError.issues,
        });

        // Return the default exception so the client still sees the standard 500.
        return new ZodSerializationException(zodError, ctx);
      },
    }),
  ],
})
class AppModule {}
```

The factory's `ctx` argument is the NestJS `ExecutionContext` for the request — walk it to get the request, the handler, the controller class, or any other request-bound metadata your tracker needs. Return whatever exception you want; the example above forwards a copy of the original to keep the client response stable.

## Substituting a different exception entirely

```ts
import { InternalServerErrorException } from '@nestjs/common';

ZodNestModule.forRoot({
  createSerializationException: (zodError, ctx) =>
    new InternalServerErrorException({
      statusCode: 500,
      message: 'Internal Server Error',     // strip any zod-nest-specific message
    }),
});
```

A maximally opaque response body — clients see a generic 500 with no hint about the failure mode. The full diagnostic still goes to the validation log if `validationLogs.output` is on.

## When the factory does NOT run

- **`@ZodResponse({ passthroughOnError: true })`** variants skip the factory entirely — soft mode is a separate code path. The output logger fires at `warn` severity instead of `error`. See [`docs/responses.md → passthroughOnError`](../responses.md#passthroughonerror).
- **No `@ZodResponse` metadata** on the handler — the interceptor is a no-op.
- **No variant matches the response status** — the interceptor falls through without validating.

In each of those cases, the factory is not invoked because validation didn't run (or didn't fail).

## Comparing to validation exceptions

| | `createValidationException` | `createSerializationException` |
|---|---|---|
| HTTP status | 400 (default) | 500 (default) |
| Body envelope | Includes `errors: z.treeifyError(err)` | Excludes the error tree |
| Factory args | `(err, argMetadata)` | `(err, executionContext)` |
| Per-pipe override | yes — pass to `new ZodValidationPipe({ createValidationException })` | no — module-scope only |
| When it runs | every input validation failure | strict-mode output failures only |

The two factories are independent — set one, both, or neither. See [`docs/module-options.md`](../module-options.md) for the option references.
