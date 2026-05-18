# Recipe: Query / path / header DTOs

A `createZodDto` bound to `@Query()`, `@Param()`, `@Headers()`, or `@Cookie()` is expanded by `applyZodNest` into one OpenAPI parameter per top-level property of the DTO's schema. The decorator picks `in`; the schema picks the field names, the per-field `required` flag, and the per-field annotations.

This is symmetric with the `nestjs-zod` predecessor library — it eliminates the single-bogus-`x-zod-nest-dto`-parameter trap you'd otherwise hit when migrating from `@ApiQuery`-decorated DTOs.

## `@Query()` — pagination + filtering

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'zod-nest';
import { z } from 'zod';

const TemplatesQuery = z
  .object({
    limit: z.coerce.number().int().positive().default(20).describe('Page size'),
    cursor: z.string().optional().describe('Opaque cursor from the previous page'),
    search: z.string().optional().describe('Substring match on template name'),
    sortBy: z.enum(['name', 'created_at']).default('name'),
  })
  .meta({ id: 'TemplatesQuery' });

class TemplatesQueryDto extends createZodDto(TemplatesQuery) {}

@Controller('templates')
class TemplatesController {
  @Get()
  list(@Query() q: TemplatesQueryDto): unknown {
    return q;
  }
}
```

The emitted operation has four parameters — `limit`, `cursor`, `search`, `sortBy` — each with its own `required` and `description`. The `TemplatesQuery` schema is still emitted under `components.schemas` (it might be referenced by `@Body()` elsewhere); the expansion is purely additive at the operation level.

## `@Param()` — typed path parameters

```ts
const TemplatePathParams = z
  .object({
    templateId: z.coerce.number().int().positive(),
  })
  .meta({ id: 'TemplatePathParams' });

class TemplatePathParamsDto extends createZodDto(TemplatePathParams) {}

@Controller('templates')
class TemplatesController {
  @Get(':templateId')
  one(@Param() params: TemplatePathParamsDto): unknown {
    return params;
  }
}
```

`templateId` becomes `{ in: 'path', required: true, schema: { type: 'integer', ... } }`. Optional fields bound to `@Param()` are coerced to `required: true` (OpenAPI 3.1 forbids optional path params); `applyZodNest` emits a single `console.warn` per coercion so the schema/route mismatch is visible.

## `@Headers()` — typed request headers

```ts
const TraceHeaders = z
  .object({
    'x-trace-id': z.string().uuid(),
    'x-correlation-id': z.string().optional(),
  })
  .meta({ id: 'TraceHeaders' });

class TraceHeadersDto extends createZodDto(TraceHeaders) {}
```

Each property becomes a header parameter (`in: 'header'`). Hyphenated names work — the Zod object literal uses string keys verbatim.

## `@Cookie()` — typed cookies

```ts
const SessionCookies = z
  .object({
    session: z.string(),
  })
  .meta({ id: 'SessionCookies' });

class SessionCookiesDto extends createZodDto(SessionCookies) {}
```

Properties become `in: 'cookie'` parameters. Same uniform expansion as the other three decorators.

## Field metadata that flows through

Anything you attach via Zod `.meta({ ... })` or `.describe(...)` on a field lands on the expanded parameter's `schema` — `description`, `examples`, `deprecated`, etc. Swagger UI reads these straight off `parameters[i].schema` and renders them in the per-field details pane.

```ts
const SearchQuery = z.object({
  q: z.string().describe('Substring match (case-insensitive)'),
  limit: z.coerce.number().describe('Page size, defaults to 20').default(20),
});
```

`applyZodNest` doesn't lift these fields to the parameter object — keeping a single source of truth on the schema is what every modern OpenAPI 3.1 consumer expects.

## When the expansion bails out

Non-object DTOs can't be split into individual parameters. `applyZodNest` throws `ZodNestDocumentError({ code: 'UNEXPANDABLE_PARAM_DTO' })` at build time when it sees one. See [`swagger-integration.md → UNEXPANDABLE_PARAM_DTO`](../swagger-integration.md#unexpandable_param_dto) for the mitigation list.

## Validation pairing

The expansion is purely a Swagger concern. Runtime validation is handled by `ZodValidationPipe` — bind it globally (or per-handler) and a `@Query() q: TemplatesQueryDto` argument is auto-validated against `TemplatesQuery`. See [`validation-pipe.md`](../validation-pipe.md) for the wiring.

Symmetry: the field that becomes a `required: true` parameter in the spec is the same field that `ZodValidationPipe` will report missing if the request omits it. One source of truth for both surfaces.
