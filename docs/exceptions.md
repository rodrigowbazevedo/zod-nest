# Exceptions

`zod-nest` exports five exception classes that surface different failure modes — input validation, output validation, schema emission, doc post-processing, and a base class. All are catchable, introspectable, and carry the original Zod error (when applicable) so exception filters can extract more than the default response body.

## Class hierarchy

```
ZodNestError                       (base — extends Error)
├── ZodNestUnrepresentableError    (schema emission, strict mode only)
└── ZodNestDocumentError           (applyZodNest post-processing failures)

ZodValidationException              (extends BadRequestException — 400)
ZodSerializationException           (extends InternalServerErrorException — 500)
```

The two `Exception` classes extend NestJS' `HttpException` chain so the default exception filter handles them out of the box. The three `Error` classes are non-HTTP failures — they surface at boot time (doc-build) or at first-DTO-read (unrepresentable construct), not on the request path.

## `ZodValidationException`

```ts
class ZodValidationException extends BadRequestException {
  readonly zodError: z.ZodError;
  readonly argMetadata?: ArgumentMetadata;
  constructor(zodError: z.ZodError, argMetadata?: ArgumentMetadata);
}
```

- **Thrown by**: `ZodValidationPipe` on input parse failure.
- **HTTP status**: 400.
- **Response body** (from `getResponse()`):

  ```ts
  {
    statusCode: 400,
    message: 'Validation failed',
    errors: z.treeifyError(zodError),
  }
  ```

- **Carries**: `zodError` (the original `z.ZodError`), `argMetadata` (`{ type, metatype, data }` — which side of the request failed).

### Custom filter example

```ts
import { Catch } from '@nestjs/common';
import { ZodValidationException } from 'zod-nest';

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

@Catch(ZodValidationException)
class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: ZodValidationException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const argType = exception.argMetadata?.type; // 'body' | 'query' | 'param' | 'custom'
    const issueCount = exception.zodError.issues.length;

    response.status(400).json({
      error: 'INVALID_INPUT',
      where: argType,
      count: issueCount,
      details: z.treeifyError(exception.zodError),
    });
  }
}
```

The factory is overridable at module scope or per-pipe instance — see [`module-options.md`](module-options.md#createvalidationexception) and [`validation-pipe.md`](validation-pipe.md#custom-exception-factory).

## `ZodSerializationException`

```ts
class ZodSerializationException extends InternalServerErrorException {
  readonly zodError: z.ZodError;
  readonly executionContext?: ExecutionContext;
  constructor(zodError: z.ZodError, executionContext?: ExecutionContext);
}
```

- **Thrown by**: `ZodSerializerInterceptor` in **strict mode** when response validation fails. Strict mode is the default — variants opt out with `@ZodResponse({ passthroughOnError: true })`.
- **HTTP status**: 500.
- **Response body**:

  ```ts
  {
    statusCode: 500,
    message: 'Response validation failed',
  }
  ```

- **Carries**: `zodError`, `executionContext` (NestJS' `ExecutionContext` — walk back to the request, handler, class).

### Why the response body has no `errors` field

A serialization failure is a **server-side** contract violation — your handler returned a value that doesn't match the schema you declared. Leaking the treeified Zod error to the client would disclose internal structure (field names, expected types, nesting depth) and would let an attacker probe your output contracts by deliberately tripping them.

`ZodValidationException` (HTTP 400) _does_ expose the tree because that's a **client-side** error — the client sent malformed input and needs to know what to fix. The principle is standard: 4xx errors are detailed (client's problem to fix), 5xx errors are opaque (server's problem to fix).

The diagnostic information isn't lost — the full treeified error is logged via [`validation logging`](logging.md) (with redaction + truncation), and `error.zodError` is still available to custom exception filters for forwarding to your observability stack. The error is _visible to operators, opaque to clients_.

Soft-mode variants (`passthroughOnError: true`) never throw this — they log at `warn` and let the original value pass through. See [`responses.md`](responses.md#passthroughonerror).

The factory is overridable at module scope only:

```ts
ZodNestModule.forRoot({
  createSerializationException: (zodError, ctx) =>
    new MyContractException(zodError, ctx.switchToHttp().getRequest()),
});
```

There is no per-pipe or per-decorator override — strict-mode failures are a global contract concern, not a per-route one.

## `ZodNestError`

```ts
class ZodNestError extends Error {
  constructor(message: string);
}
```

Base class for non-HTTP `zod-nest` failures (`ZodNestUnrepresentableError`, `ZodNestDocumentError`). Catch this if you want to handle any zod-nest-specific failure with a single filter / `try { ... } catch (e instanceof ZodNestError) { ... }` block.

## `ZodNestUnrepresentableError`

```ts
class ZodNestUnrepresentableError extends ZodNestError {
  readonly path: ReadonlyArray<string | number>;
  readonly zodType: string;
  constructor(path: ReadonlyArray<string | number>, zodType: string);
}
```

- **Thrown by**: `toOpenApi` (single-schema mode) or `bulkEmit` (registry mode) in **strict mode** when a Zod construct can't be represented as JSON Schema.
- **When**: schema emission — at first `Dto.id` read, at `applyZodNest`, or at any direct `toOpenApi` call.
- **Carries**: `path` (where in the schema tree the unrepresentable construct lives), `zodType` (the Zod type name as a string — `'bigint'`, `'date'`, `'transform'`, …).

```ts
try {
  toOpenApi(z.bigint(), { io: 'input', registry, strict: true });
} catch (e) {
  if (e instanceof ZodNestUnrepresentableError) {
    console.error(`Unrepresentable ${e.zodType} at ${e.path.join('.')}`);
  }
}
```

**Mitigation** — four options, most-targeted first:

1. **Drop in a shipped preset** from `zod-nest/helpers` — `FileSchema` / `BlobSchema` / `BufferSchema` cover the common `z.instanceof(File | Blob | Buffer)` cases without any registration of your own.

   ```ts
   import { z } from 'zod';
   import { createZodDto } from 'zod-nest';
   import { FileSchema } from 'zod-nest/helpers';

   class UploadDto extends createZodDto(z.object({ file: FileSchema })) {}
   ```

2. **`overrideJSONSchema(schema, fragment)`** — register a fixed JSON Schema fragment for a specific schema _instance_. Pair with the `zod-nest/helpers` fragment catalog (`binaryFragment`, `uuidFragment`, `opaqueFragment`, …) or the `binary()` / `opaque()` sugar functions so you don't have to hand-write the magic objects. Pass `{ input, output }` instead of a raw fragment when the request and response sides need different shapes (coercion helpers). See [`recipes/custom-openapi-overrides.md`](recipes/custom-openapi-overrides.md#per-instance-registration-with-overridejsonschema).

   ```ts
   import { z } from 'zod';
   import { overrideJSONSchema } from 'zod-nest';
   import { binary, uuidFragment } from 'zod-nest/helpers';

   const PdfUpload = overrideJSONSchema(
     z.instanceof(File),
     binary({ contentMediaType: 'application/pdf' }),
   );
   const UserId = overrideJSONSchema(z.custom<string>(), uuidFragment);
   ```

3. **`override` callback** — pass a per-call `override` to `applyZodNest` / `toOpenApi` that mutates `ctx.jsonSchema` for matching types. Useful when the mapping should apply to _every_ schema of a given Zod type. See [`swagger-integration.md`](swagger-integration.md#override-callback) for the pattern.

4. **`strict: false`** — globally relax the check; unrepresentable constructs emit `{}`. Reach for this only when you're knowingly trading schema fidelity for a clean boot.

## `ZodNestDocumentError`

```ts
class ZodNestDocumentError extends ZodNestError {
  readonly code: 'AMBIGUOUS_RENAME' | 'DANGLING_REF' | 'UNEXPANDABLE_PARAM_DTO';
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: ZodNestDocumentErrorCode, message: string, details?: Record<string, unknown>);
}
```

- **Thrown by**: `applyZodNest` at doc-build time.
- **When**: between `SwaggerModule.createDocument(...)` and `SwaggerModule.setup(...)`. Caught means the spec is invalid — the doc would have surfaced broken refs or ambiguous schemas to clients.

### `code: 'AMBIGUOUS_RENAME'`

Two distinct DTO classes target the same registry id with differing bodies. The rename pass can't write `components.schemas[id]` unambiguously — which body wins?

```ts
const userA = z.object({ id: z.string() }).meta({ id: 'User' });
const userB = z.object({ uuid: z.uuid() }).meta({ id: 'User' }); // collision

class UserDtoA extends createZodDto(userA) {}
class UserDtoB extends createZodDto(userB) {}

applyZodNest(raw);
// → ZodNestDocumentError({ code: 'AMBIGUOUS_RENAME', details: { id: 'User', classes: [...] } })
```

Fix: give each schema a distinct id.

### `code: 'DANGLING_REF'`

A `$ref` in the doc points at a `components.schemas` key that no longer exists after the merge / rewrite passes. The `details` payload lists every offending ref with a per-ref hint inferred from collected usage:

- _Seen on input side only_ → input-only DTO not registered to the right `ZodNestRegistry`.
- _Seen on output side only_ → output-only DTO (e.g. only referenced in `@ZodResponse`) not registered.
- _Seen on both sides_ → registry mismatch despite usage.
- _Unknown_ → likely a `.meta({ id })` typo or an entirely unregistered DTO.

Fix: register the DTO via `createZodDto` to the correct registry, or correct the `.meta({ id })` typo.

### `code: 'UNEXPANDABLE_PARAM_DTO'`

A `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` argument resolved to a `createZodDto` whose underlying schema is not an object — there is no top-level `properties` record to iterate, so the marker parameter can't be expanded into individual parameters.

```ts
const Tags = z.array(z.string()); // array — has no `properties`
class TagsDto extends createZodDto(Tags) {}

@Controller()
class TagsController {
  @Get()
  list(@Query() tags: TagsDto): unknown {
    /* … */
  }
}

applyZodNest(raw);
// → ZodNestDocumentError({
//     code: 'UNEXPANDABLE_PARAM_DTO',
//     details: { dtoId: 'TagsDto', in: 'query', io: 'input' },
//   })
```

Fix — pick one:

- Use `@Body()` instead. Non-object DTOs are perfectly valid request bodies.
- Restructure the schema as an object whose fields become the parameters: `z.object({ tags: z.array(z.string()) })` becomes `@Query() x: TagsQueryDto` with a single `tags` parameter (typed as a comma-separated array via OpenAPI's `style: 'form', explode: true` convention).
- For one-off primitive parameters, drop the DTO entirely and inline the type: `@Query('q') q: string` is a no-op for `ZodValidationPipe` (validation only kicks in when the metatype is a zod-nest DTO class).

See [`docs/recipes/query-param-dtos.md`](recipes/query-param-dtos.md) for the per-decorator expansion contract.

## Catching multiple exception types

NestJS' `@Catch` decorator accepts multiple exception classes — useful for routing zod-nest exceptions to a single handler:

```ts
import { ZodSerializationException, ZodValidationException } from 'zod-nest';

@Catch(ZodValidationException, ZodSerializationException)
class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodValidationException | ZodSerializationException, host: ArgumentsHost) {
    const isInput = exception instanceof ZodValidationException;
    const status = isInput ? 400 : 500;
    // ... format response, log, etc.
  }
}
```

For non-HTTP errors (`ZodNestUnrepresentableError`, `ZodNestDocumentError`), use a `try { ... } catch (e instanceof ZodNestError)` block at bootstrap — they don't reach the request lifecycle.

## Inheritance for custom errors

When you build custom exception factories, extending the built-in classes preserves filter compatibility:

```ts
import { ZodValidationException } from 'zod-nest';

class UnprocessableValidationException extends ZodValidationException {
  constructor(zodError: z.ZodError, argMetadata?: ArgumentMetadata) {
    super(zodError, argMetadata);
    Object.defineProperty(this, 'status', { value: 422 });
  }
}

ZodNestModule.forRoot({
  createValidationException: (err, meta) => new UnprocessableValidationException(err, meta),
});
```

A filter catching `ZodValidationException` will still match the subclass. Use this when you want the same introspection (`zodError`, `argMetadata`) but a different HTTP status or message envelope.
