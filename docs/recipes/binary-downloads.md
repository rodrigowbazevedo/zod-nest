# Recipe: Binary file downloads

Handlers that stream binary content (CSVs, PDFs, octet-stream exports) need the OpenAPI response to declare `format: 'binary'`. Pre-`zod-nest` migrations typically wrote a manual `@ApiOkResponse({ content: { 'application/octet-stream': ... } })` because `@ZodResponse` couldn't model a non-JSON content type. **You don't need that workaround anymore.** The canonical pattern is `overrideJSONSchema(BlobSchema, { type: 'string', format: 'binary' })` + `@ZodResponse({ type: BlobDto })`.

## Pattern

```ts
import { z } from 'zod';
import { createZodDto, overrideJSONSchema, ZodResponse } from 'zod-nest';

// One opaque schema for any binary payload.
const BlobSchema = z.instanceof(Object).meta({ id: 'Blob' });
overrideJSONSchema(BlobSchema, { type: 'string', format: 'binary' });

export class BlobDto extends createZodDto(BlobSchema) {}
```

Use it on every binary-returning handler:

```ts
import { Controller, Get, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

@Controller('exports')
export class ExportsController {
  @Get(':id/csv')
  @ZodResponse({ type: BlobDto })
  download(@Res({ passthrough: true }) res: Response): StreamableFile {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
    return new StreamableFile(this.stream());
  }
}
```

The emitted doc has `responses.200.content['application/json'].schema = { $ref: '#/components/schemas/Blob' }`, and `components.schemas.Blob` resolves to `{ type: 'string', format: 'binary' }` — which Swagger UI, OpenAPI clients, and `swagger-typescript-api` codegen all understand as a binary download.

## Removing the manual `@ApiOkResponse` workaround during migration

If your existing handler looks like this:

```ts
// ❌ Pre-fix workaround — remove during migration to zod-nest@1.4+
@Get(':id/csv')
@ApiOkResponse({
  content: {
    'application/octet-stream': {
      schema: { type: 'string', format: 'binary' },
    },
  },
})
download(@Res({ passthrough: true }) res: Response) { ... }
```

Replace with the `@ZodResponse` form above. Two things change:

1. The decorator drops to a single `@ZodResponse({ type: BlobDto })` — no more bespoke `content` object.
2. Your runtime validation now applies (the handler's return shape is checked against the DTO schema). If the validator should be a no-op for an already-binary response, set `passthroughOnError: true` so the handler doesn't fail in production when `BlobSchema` rejects a `StreamableFile`.

The content type declared in the doc is `application/json` (because `@ZodResponse` is JSON-oriented), but the schema body is the binary-string shape — clients that key off `format: 'binary'` (the OpenAPI-correct discriminator) will handle the response as a file regardless of the media-type label. If you need the response to literally surface as `application/octet-stream` in the doc — e.g. because a downstream consumer keys off the media type rather than the format — keep the manual `@ApiOkResponse({ content: { 'application/octet-stream': ... } })` alongside `@ZodResponse`, and `@nestjs/swagger` will merge both content types on the same response card.

## See also

- [`custom-openapi-overrides.md`](custom-openapi-overrides.md) — the full `overrideJSONSchema` reference.
- [`responses.md → "OpenAPI emission"`](../responses.md#openapi-emission) — how `@ZodResponse` writes its response card.
