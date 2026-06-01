# Recipe: Multi-status responses

Stack `@ZodResponse` per status code. Each variant carries its own DTO; `ZodSerializerInterceptor` picks the one matching the actual HTTP status at request time.

## The basic shape

```ts
import { Controller, Get, HttpStatus, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { createZodDto, ZodResponse } from 'zod-nest';

class UserDto extends createZodDto(z.object({ id: z.string() }), { id: 'User' }) {}
class ErrorDto extends createZodDto(z.object({ code: z.number() }), { id: 'Error' }) {}
class FatalDto extends createZodDto(z.object({ trace: z.string() }), { id: 'Fatal' }) {}

@Controller('users')
class UsersController {
  @Get(':id')
  @ZodResponse({ type: UserDto }) // success — 200 inferred from GET
  @ZodResponse({ status: HttpStatus.NOT_FOUND, type: ErrorDto })
  @ZodResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, type: FatalDto })
  async getUser(): Promise<UserDto> {
    const user = await this.repo.find();
    if (!user) {
      throw new NotFoundException({ code: 404 });
    }
    return user;
  }
}
```

The success variant omits `status` and lets the precedence chain infer it (200 here, since the method is `@Get`). Only the off-happy-path variants need explicit numbers. See [`docs/responses.md → status resolution precedence`](../responses.md#status-resolution-precedence) for the full chain.

OpenAPI emits three `responses[200|404|500]` entries with the right schema under each.

## Status resolution at request time

The interceptor matches `response.statusCode` against each variant's `status`. The status itself comes from NestJS' standard resolution — `@HttpCode` on the handler, then the method default. `@ZodResponse` doesn't apply `@HttpCode` internally. See [`docs/responses.md → status resolution precedence`](../responses.md#status-resolution-precedence).

For thrown exceptions (`NotFoundException`, `InternalServerErrorException`), NestJS' exception filter sets the response status before the interceptor sees the final code. As long as your `@ZodResponse({ status: 404 })` variant matches the thrown 404, the validation kicks in for that variant.

## Validating thrown exception bodies

When the 404 path throws `new NotFoundException({ code: 404 })`, the response body is `{ statusCode: 404, message: 'Not Found', code: 404 }`. To validate that against `ErrorDto`, your schema needs to match the **full** Nest exception body — or use a `.passthrough()` / `.loose()` shape:

```ts
const errorSchema = z.object({ code: z.number() }).loose(); // tolerate Nest's `statusCode` + `message`

class ErrorDto extends createZodDto(errorSchema, { id: 'Error' }) {}
```

Alternatively, declare an `ErrorEnvelopeDto` that mirrors Nest's full exception shape (`statusCode`, `message`, `error`, plus your custom keys) and use that for every error-status variant in the app.

## Mixing strict and soft variants

```ts
@Get('flaky')
@ZodResponse({              type: UserDto })                            // strict — success, 200 inferred
@ZodResponse({ status: 500, type: FatalDto, passthroughOnError: true }) // soft — logs and passes through
flaky(): UserDto {
  // ...
}
```

If a 200 response fails its schema, the client sees the default 500. If a 500 response (e.g. forwarded from an upstream) fails its `FatalDto` schema, the original 500 body passes through to the client unchanged and a `warn` log is emitted. Useful when your error path is forwarding a shape you don't fully control.

## OpenAPI rendering

Swagger UI shows each declared status as a separate response card:

```
GET /users/:id
  ├─ 200  application/json  User
  ├─ 404  application/json  Error
  └─ 500  application/json  Fatal
```

If your declared statuses don't include the actual ones NestJS may return (e.g. you forgot 400 for invalid `:id` params), the response card is missing — the spec only documents what you declared via `@ZodResponse`.

## Reading the metadata programmatically

```ts
import { getResponseVariants } from 'zod-nest';

const variants = getResponseVariants(UsersController.prototype.getUser);
// → [
//     { status: 200, kind: 'single', dto: UserDto,  passthroughOnError: false, ... },
//     { status: 404, kind: 'single', dto: ErrorDto, passthroughOnError: false, ... },
//     { status: 500, kind: 'single', dto: FatalDto, passthroughOnError: false, ... },
//   ]
```

The metadata is read in source-author order — TypeScript decorators apply bottom-up, but `appendResponseVariant` prepends, so the metadata array matches what the developer typed. Useful for building custom doc generators or telemetry.

See [`docs/responses.md`](../responses.md) for the full reference.
