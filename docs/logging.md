# Validation logging

`zod-nest` ships a lightweight, opt-in logger that fires **only on validation failures** — successful validations are silent. It's wired to both `ZodValidationPipe` (input) and `ZodSerializerInterceptor` (output) and is configured through `ZodNestModule.forRoot()`.

## Turning logging on

```ts
import { ZodNestModule } from 'zod-nest';

@Module({
  imports: [
    ZodNestModule.forRoot({
      validationLogs: true,                          // both sides
      // validationLogs: { input: true },            // input only
      // validationLogs: { output: true },           // output only
      // validationLogs: { input: false, output: true }, // explicit form
    }),
  ],
})
class AppModule {}
```

Default is off on both sides. Disabling a side replaces its logger with a no-op function — there is no per-request cost when a side is off.

## When does it fire?

| Event | Severity | Logger context |
|---|---|---|
| Input validation failure (request body / query / param) | `error` | `'ZodValidationPipe'` |
| Output validation failure on a **strict** variant (`passthroughOnError: false`, the default) | `error` | `'ZodSerializerInterceptor'` |
| Output validation failure on a **soft** variant (`passthroughOnError: true`) | `warn` | `'ZodSerializerInterceptor'` |

The severity is decided by `zod-nest`, not by the logger adapter — your `LoggerService.error(...)` vs `LoggerService.warn(...)` is called accordingly.

`passthroughOnError` failures log at `warn` rather than `error` because the request itself succeeded — the deviation from the declared contract is real but not fatal. The original value passes through to the client; logging keeps the deviation visible without breaking the response.

## Log payload shape

Every log entry passes a single payload object to the logger (positional `message`, `trace`, `context` arguments are filled in for NestJS compatibility):

```ts
{
  message: 'Request validation failed' | 'Response validation failed',
  side:    'input' | 'output',
  dto:     string,                  // 'UserDto' | '[UserDto]' | '[A, B]'
  errors:  z.treeifyError(zodError),
  value:   <redacted + truncated input/output>,

  // Output-side only
  status?:  number,                 // resolved HTTP status (e.g. 200, 500)
  handler?: string,                 // 'UsersController.getUser' best-effort

  // Input-side only
  argType?: 'body' | 'query' | 'param' | 'custom',
}
```

A typical strict-mode response-validation entry looks like:

```ts
logger.error({
  message: 'Response validation failed',
  side: 'output',
  dto: 'UserDto',
  errors: { errors: [], properties: { email: { errors: ['Invalid email'] } } },
  value: { id: 'u1', email: 'not-an-email' },
  status: 200,
  handler: 'UsersController.getUser',
}, undefined, 'ZodSerializerInterceptor');
```

### DTO label conventions

| Variant kind | `dto` label |
|---|---|
| `@ZodResponse({ type: UserDto })` | `'UserDto'` |
| `@ZodResponse({ type: [UserDto] })` | `'[UserDto]'` |
| `@ZodResponse({ type: [UserDto, TagDto] })` | `'[UserDto, TagDto]'` |
| `@Body() body: UserDto` (input) | `'UserDto'` |

For inputs, the label is whatever `argMetadata.metatype?.name` resolves to — typically the DTO class name.

### `errors` shape

`errors` is the output of `z.treeifyError(zodError)` — a recursive tree that mirrors the schema shape. For a flat object schema:

```ts
{
  errors: [],
  properties: {
    email: { errors: ['Invalid email'] },
    age:   { errors: ['Expected number, got string'] },
  },
}
```

For nested or array shapes the tree extends accordingly. This is the same body shape that `ZodValidationException` / `ZodSerializationException` expose to clients — useful for cross-referencing logs with API responses.

## Redaction

Before logging, the `value` field is walked recursively and keys matching `redactKeys` are replaced with `'[REDACTED]'`.

- **Case-insensitive.** `password`, `Password`, `PASSWORD` all match.
- **At any depth.** Keys deep inside nested objects and arrays are matched.
- **Per-key, not per-value.** A non-secret value under a `password` key is still redacted; a secret value under an unmatched key is not. Redaction is structural, not content-aware.
- **Arrays passed through.** Array elements are walked, not redacted by index — only object keys trigger redaction.

The default redaction set is:

| Category | Keys |
|---|---|
| Credentials | `password`, `secret`, `apiKey` |
| Auth headers & tokens | `authorization`, `bearer`, `token`, `accessToken`, `refreshToken`, `jwt` |
| Session cookies | `cookie`, `set-cookie` |

Supplying `redactKeys` **replaces** this list — see [`module-options.md`](module-options.md#redactkeys) for the rationale and the spread pattern for adding keys without losing the defaults.

### Circular references

Self-referential structures are detected via a `WeakSet`. Once a node is seen twice on the same path, it's replaced with the string `'[CIRCULAR]'`:

```ts
const a: { self?: unknown } = {};
a.self = a;

// logged as:
{ self: '[CIRCULAR]' }
```

This guard runs before truncation, so circular structures never blow up `JSON.stringify`.

## Truncation

After redaction, values are size-capped by `maxLoggedValueBytes` (default `4096`). Anything larger than the cap is replaced with:

```ts
{
  _truncated: true,
  _originalBytes: number,           // byte size of the original JSON.stringify output
  _preview: string,                 // first (maxBytes - 100) bytes of the serialized value
}
```

The 100-byte reserve in the preview budget leaves room for the envelope's own keys, so the resulting payload stays under the cap.

**Unserializable values** (e.g. BigInts without a replacer, broken `toJSON` methods that throw) get a different envelope:

```ts
{ _truncated: true, _originalBytes: -1, _reason: 'unserializable' }
```

`_originalBytes: -1` is the sentinel for "we couldn't measure this — `JSON.stringify` threw".

## Using a structured logger

NestJS' `LoggerService` interface is intentionally simple — five methods (`log`, `error`, `warn`, `debug`, `verbose`) — and `zod-nest` passes a single object payload as the first positional argument when logging. Common structured loggers can be adapted in a handful of lines.

### pino

```ts
import pino from 'pino';
import type { LoggerService } from '@nestjs/common';

const logger = pino();

const pinoAdapter: LoggerService = {
  log:     (msg, context)        => logger.info({ context }, typeof msg === 'string' ? msg : ''),
  error:   (msg, trace, context) => logger.error({ context, trace, ...(typeof msg === 'object' ? msg : { msg }) }),
  warn:    (msg, context)        => logger.warn({ context, ...(typeof msg === 'object' ? msg : { msg }) }),
  debug:   (msg, context)        => logger.debug({ context, ...(typeof msg === 'object' ? msg : { msg }) }),
  verbose: (msg, context)        => logger.trace({ context, ...(typeof msg === 'object' ? msg : { msg }) }),
};

ZodNestModule.forRoot({ logger: pinoAdapter, validationLogs: true });
```

The same shape works for winston, bunyan, or your in-house wrapper. The point is that `msg` will be the payload object documented above — your adapter decides whether to spread it into the log line, attach it as a `meta` field, or split error / context into separate properties.

### Built-in NestJS Logger

The default adapter is `new Logger('ZodValidation')`, which calls `Logger.error(payload, undefined, context)`. NestJS' Logger will JSON-stringify the payload as part of its standard formatter. This works out of the box; no adapter needed.

## Performance notes

- **Disabled side has zero per-request cost.** `noopLogValidationFailure` is a `() => {}` function; the call still happens but the body is empty.
- **Redaction runs only on failure.** A successful validation never triggers the walker.
- **Truncation runs only on failure.** Successful validations never serialize the value.
- **Redaction is `O(n)` in value size.** The walker visits each key once and uses a `WeakSet` for cycle detection. For values near the `maxLoggedValueBytes` cap, factor in one full walk plus one `JSON.stringify` per failure.
- **The redaction key set is interned once** (lowercased and stored in a `Set`) per `forRoot()` call, not per failure. Adding keys at runtime requires a new `forRoot()` invocation.

If your hot path is producing thousands of validation failures per second, prefer toggling logging off for that side (e.g. `validationLogs: { input: false, output: true }`) over trying to optimize the formatter. The failure itself is more expensive than the logging.

## Disabling logging at request time

There's no per-request escape hatch. Logging is module-scope and controlled by `validationLogs`. The closest equivalents:

- For untrusted upstream shapes you want to silence — use `passthroughOnError: true` on the `@ZodResponse` variant. Output failures still log, but at `warn` severity rather than `error`, so you can filter by level downstream.
- For a specific noisy route — register `ZodValidationPipe` manually on the route without going through `ZodNestModule.forRoot()`, passing a custom `createValidationException` that doesn't surface in your error stream.

In practice the structured payload + adapter-level filtering covers most use cases without code changes.
