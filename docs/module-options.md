# Module options

`ZodNestModule.forRoot(options?)` accepts a single `ZodNestModuleOptions` object and exposes the resolved state via the `ZOD_NEST_OPTIONS` DI token. Every option is optional — calling `forRoot()` with no argument is valid and wires the pipe + interceptor globally with safe defaults.

```ts
import { ZodNestModule } from 'zod-nest';

@Module({
  imports: [
    ZodNestModule.forRoot({
      /* options */
    }),
  ],
})
class AppModule {}
```

`forRoot()` itself is optional. The pipe and interceptor work standalone as plain `APP_PIPE` / `APP_INTERCEPTOR` providers — they `@Optional()`-inject the options token and fall through to safe defaults. Reach for `forRoot` when you want shared logging, custom exceptions, or shared redaction across the pipe and interceptor.

The module is marked `global` so the `ZOD_NEST_OPTIONS` token is injectable from feature modules — e.g. a custom pipe that wants the same logger and redact list as the module-wired one can `@Inject(ZOD_NEST_OPTIONS)`.

## `createValidationException`

```ts
type CreateValidationException = (err: z.ZodError, argMetadata: ArgumentMetadata) => unknown;
```

Factory for the exception thrown by `ZodValidationPipe` on input validation failure. The default factory builds a `ZodValidationException` (HTTP 400, body `{ statusCode, message: 'Validation failed', errors: z.treeifyError(zodError) }`).

```ts
import { HttpException, HttpStatus } from '@nestjs/common';

ZodNestModule.forRoot({
  createValidationException: (zodError) =>
    new HttpException(
      { message: 'invalid', issuesCount: zodError.issues.length },
      HttpStatus.UNPROCESSABLE_ENTITY,
    ),
});
```

The factory receives the full `ZodError` and the NestJS `ArgumentMetadata` (which side of the route the failure came from — `body`, `query`, `param`, or `custom`). Return anything `throw`-able — typically a NestJS `HttpException` subclass.

**Per-instance override.** Passing `createValidationException` directly to a `ZodValidationPipe` constructor wins over the module-scope factory. The module factory is the default; the per-pipe option is the local override.

## `createSerializationException`

```ts
type CreateSerializationException = (
  err: z.ZodError,
  executionContext: ExecutionContext,
) => unknown;
```

Factory for the exception thrown by `ZodSerializerInterceptor` on output validation failure. The default factory builds a `ZodSerializationException` (HTTP 500, body `{ statusCode, message: 'Response validation failed' }` — the zod error tree is deliberately not in the body; see [`exceptions.md`](exceptions.md#why-the-response-body-has-no-errors-field)).

```ts
ZodNestModule.forRoot({
  createSerializationException: (zodError, ctx) =>
    new MyInternalContractError(zodError, ctx.switchToHttp().getRequest()),
});
```

The factory receives the full `ZodError` and the NestJS `ExecutionContext`, which lets you walk back to the request, the handler, or the class — useful for custom telemetry or correlation ids.

**Strict mode only.** This factory is called when a `@ZodResponse({ passthroughOnError: false })` variant (the default) fails validation. Variants marked `passthroughOnError: true` never invoke this factory — the original value passes through with a `warn`-level log entry instead.

## `validationLogs`

```ts
type ValidationLogs = boolean | { input?: boolean; output?: boolean };
```

Default: `false` on both sides.

Failure-only logging — successful validations do not log. The boolean form is shorthand for `{ input: true, output: true }`. The granular form lets you toggle each side independently:

```ts
ZodNestModule.forRoot({ validationLogs: true }); // both
ZodNestModule.forRoot({ validationLogs: { output: true } }); // output only
ZodNestModule.forRoot({ validationLogs: { input: false, output: true } });
```

Toggling a side off makes that side's logger a no-op function — there is no runtime cost beyond the call. See [`logging.md`](logging.md) for the log payload shape, redaction, and truncation behaviour.

## `logger`

```ts
logger?: LoggerService;
```

Default: `new Logger('ZodValidation')` (NestJS' built-in Logger with the `ZodValidation` context tag).

Override with any object implementing the NestJS `LoggerService` interface (`log`, `error`, `warn`, `debug`, `verbose`). Common adapters: pino, winston, or your own structured logger.

```ts
import type { LoggerService } from '@nestjs/common';

const pinoAdapter: LoggerService = {
  log: (msg, ctx) => pino.info({ ctx }, msg),
  error: (msg, trace, ctx) => pino.error({ ctx, trace }, msg),
  warn: (msg, ctx) => pino.warn({ ctx }, msg),
  debug: (msg, ctx) => pino.debug({ ctx }, msg),
  verbose: (msg, ctx) => pino.trace({ ctx }, msg),
};

ZodNestModule.forRoot({ logger: pinoAdapter, validationLogs: true });
```

Side-specific contexts are still set internally — input failures log under `'ZodValidationPipe'`, output failures under `'ZodSerializerInterceptor'`. Your adapter sees these via the `context` argument that NestJS' `LoggerService` passes through.

## `redactKeys`

```ts
redactKeys?: readonly string[];
```

Default: `DEFAULT_REDACT_KEYS` (see below).

Keys whose values are replaced with `'[REDACTED]'` before logging. Matching is **case-insensitive** and applied **at any depth** in the logged value — a `password` field nested 5 levels deep is redacted just like a top-level one.

**Supplying `redactKeys` replaces the default list — there is no merge.** This is intentional: if your app stores secrets under unusual key names, you want to be explicit about the full redaction set, not have a partial list silently augment the defaults.

To **add** keys to the default list, spread:

```ts
import { DEFAULT_REDACT_KEYS, ZodNestModule } from 'zod-nest';

ZodNestModule.forRoot({
  validationLogs: true,
  redactKeys: [...DEFAULT_REDACT_KEYS, 'sessionId', 'csrfToken'],
});
```

### `DEFAULT_REDACT_KEYS`

| Category              | Keys                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| Credentials           | `password`, `secret`, `apiKey`                                           |
| Auth headers & tokens | `authorization`, `bearer`, `token`, `accessToken`, `refreshToken`, `jwt` |
| Session cookies       | `cookie`, `set-cookie`                                                   |

The constant is exported so you can introspect, extend, or replace it programmatically.

## `maxLoggedValueBytes`

```ts
maxLoggedValueBytes?: number;
```

Default: `DEFAULT_MAX_LOGGED_VALUE_BYTES` (= `4096`).

Maximum size, in **UTF-8 bytes**, of any single logged value. Values larger than this get replaced with a truncated envelope:

```ts
{
  _truncated: true,
  _originalBytes: <number>,    // size of the original serialized value in bytes
  _preview: <string>,          // first (maxBytes - 100) bytes of JSON.stringify(value)
}
```

The 100-byte reserve in the preview budget leaves space for the envelope's own keys without exceeding the cap. Unserializable values (circular references that escape the WeakSet guard, BigInts without a replacer, etc.) become:

```ts
{ _truncated: true, _originalBytes: -1, _reason: 'unserializable' }
```

Tune this based on your logger's per-line cost. The default trades some debuggability for safety against runaway payload sizes.

## `streamContentTypes`

```ts
streamContentTypes?: readonly string[];
```

Default: `DEFAULT_STREAM_CONTENT_TYPES` (see below).

Response content types that [`@ZodResponse`](responses.md#streaming-responses-contenttype--stream) treats as **streams** — written straight to the response buffer, so `ZodSerializerInterceptor` skips validation. This option is consumed at runtime by the interceptor; a response whose effective content type matches the set (and has no explicit `stream` override) passes through unvalidated.

**Supplying `streamContentTypes` merges with the defaults — they are never dropped.** Unlike `redactKeys`, this list is additive: SSE / NDJSON / binary detection always stays on, and you only list your extras.

```ts
import { ZodNestModule } from 'zod-nest';

ZodNestModule.forRoot({
  // text/csv now skips validation too; all built-in stream types still apply.
  streamContentTypes: ['text/csv', 'application/zip'],
});
```

A trailing `/*` entry matches a media-type family (`font/*` → `font/woff2`, `font/ttf`, …). Comparison is case-insensitive and ignores `;`-parameters (`text/event-stream; charset=utf-8` matches `text/event-stream`).

> This affects the **runtime validation skip** only. The OpenAPI media-type key still comes from the per-response `contentType` option (or a built-in stream-typed `@Header`) — module options aren't available at decoration time. To document an off-list type, set `contentType` on `@ZodResponse`.

### `DEFAULT_STREAM_CONTENT_TYPES`

| Category       | Entries                                       |
| -------------- | --------------------------------------------- |
| Streaming      | `text/event-stream`, `application/x-ndjson`   |
| Binary / files | `application/octet-stream`, `application/pdf` |
| Media families | `image/*`, `audio/*`, `video/*`               |

The constant is exported so you can introspect, extend, or replace it programmatically.

## `ZOD_NEST_OPTIONS` token

```ts
import { Inject } from '@nestjs/common';
import { ZOD_NEST_OPTIONS } from 'zod-nest';

import type { NormalizedZodNestOptions } from 'zod-nest';

@Injectable()
class MyPipe {
  constructor(@Inject(ZOD_NEST_OPTIONS) private readonly opts: NormalizedZodNestOptions) {}
}
```

`NormalizedZodNestOptions` is the resolved option shape — `validationLogs` has been collapsed into `logInputFailure` / `logOutputFailure` no-op-when-disabled functions, the logger is materialized, the redaction set is interned, and `streamContentTypes` is compiled into a `streamMatcher` (built-in defaults ∪ your extras). Downstream consumers should depend on this shape, not on the raw `ZodNestModuleOptions`.

## Option-precedence summary

| Concern          | Module option                  | Per-pipe / per-decorator override                      |
| ---------------- | ------------------------------ | ------------------------------------------------------ |
| Input exception  | `createValidationException`    | `new ZodValidationPipe({ createValidationException })` |
| Output exception | `createSerializationException` | none — module-scope only                               |
| Logging on / off | `validationLogs`               | none — module-scope only                               |
| Logger instance  | `logger`                       | none — module-scope only                               |
| Redaction set    | `redactKeys`                   | none — module-scope only                               |
| Truncation cap   | `maxLoggedValueBytes`          | none — module-scope only                               |

Only the input exception has a per-pipe override; everything else is module-scope by design — logging, redaction, and truncation are cross-cutting concerns whose value comes from being consistent across the app.
