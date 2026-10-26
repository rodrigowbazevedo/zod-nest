# Recipe: Faster validation with `zod/compile`

zod 4.5+ can compile a schema into a generated fast path for valid input ([`z.compile`](https://zod.dev/blog/introducing-z-compile)). It is 3–10x faster on large objects and arrays. Request bodies and `@ZodResponse` payloads are exactly that workload.

The fast path runs only on a **sync** parse, so zod-nest parses sync-first whenever it detects the compiler. This is the [`parseMode`](../module-options.md#parsemode) option's `'auto'` default. Turning it on takes one import.

## Pattern

```ts
// main.ts: the first import, before any module that builds a schema
import 'zod/compile';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

const app = await NestFactory.create(AppModule);
```

Nothing else changes. `ZodValidationPipe`, `ZodSerializerInterceptor` and the multipart decorators pick up the compiler automatically.

A single schema can opt in instead of the whole app. Use `z.compile(schema)` and hand the clone to `createZodDto` or `new ZodValidationPipe(...)`. `'auto'` detects the clone too.

## What stays the same

- Error objects, `ZodValidationException` / `ZodSerializationException` bodies, `passthroughOnError`, and validation logging. Invalid input falls back to zod's runtime parser, so issues are identical.
- Schemas with an async `.refine()` / `.transform()`. The sync attempt throws `$ZodAsyncError`, zod-nest re-runs with `safeParseAsync`, and it remembers the schema so later parses go straight to async.

## Gotchas

- **Import order matters.** `zod/compile` hooks schemas built after it loads. A schema created at module top level before the import is never compiled.
- **`jitless` wins.** `z.config({ jitless: true })` (CSP / no-`eval` environments) disables the global compiler, and `'auto'` then keeps `safeParseAsync`.
- **Sync transforms can run twice, once.** On the first parse of a schema that turns out to be async, any sync transform or refinement that runs before the async step executes again in the async retry. Keep side effects out of transforms, or set `parseMode: 'async'`.
- **Multipart decorators always use `'auto'`.** `@ZodMultipartBody`, `@ZodUploadedFile` and `@ZodUploadedFiles` are param decorators and can't read module options.

## Forcing a mode

```ts
ZodNestModule.forRoot({ parseMode: 'sync-first' }); // sync-first even without zod/compile
ZodNestModule.forRoot({ parseMode: 'async' }); // never sync: the pre-3.9 behavior
```
