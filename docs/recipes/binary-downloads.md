# Recipe: Binary file downloads

Handlers that stream binary content (CSVs, PDFs, octet-stream exports) are written straight to the response buffer — there's no JSON body to validate, and the OpenAPI response should surface under the real media type. `@ZodResponse` models this directly with [`contentType` + `stream`](../responses.md#streaming-responses-contenttype--stream): set `contentType: 'application/octet-stream'` (or let it infer from a `@Header('Content-Type', …)`) and the response card uses that media type, with validation skipped automatically.

Pair it with `overrideJSONSchema(BlobSchema, { type: 'string', format: 'binary' })` so the referenced schema body reads as a binary string for codegen.

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
  @ZodResponse({ type: BlobDto, contentType: 'application/octet-stream' })
  download(@Res({ passthrough: true }) res: Response): StreamableFile {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
    return new StreamableFile(this.stream());
  }
}
```

The emitted doc has `responses.200.content['application/octet-stream'].schema = { $ref: '#/components/schemas/Blob' }`, and `components.schemas.Blob` resolves to `{ type: 'string', format: 'binary' }` — which Swagger UI, OpenAPI clients, and `swagger-typescript-api` codegen all understand as a binary download. Because `application/octet-stream` is a built-in stream type, `stream` defaults to `true` and `ZodSerializerInterceptor` never tries to validate the `StreamableFile` against `BlobSchema`.

## Removing the manual `@ApiOkResponse` workaround during migration

If your existing handler looks like this:

```ts
// ❌ Pre-fix workaround — remove during migration to zod-nest
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

Replace it with the `@ZodResponse({ type: BlobDto, contentType: 'application/octet-stream' })` form above. The bespoke `content` object collapses into the decorator, the doc still surfaces the real `application/octet-stream` media type, and validation is skipped (no need for `passthroughOnError` to tolerate a `StreamableFile` that wouldn't pass `BlobSchema`).

If you'd rather keep the JSON-labelled card (a `$ref` under `application/json` whose body is `format: 'binary'`), simply omit `contentType` — `@ZodResponse({ type: BlobDto })` still works, and clients that key off `format: 'binary'` handle it as a file. Set `contentType` only when a consumer keys off the media-type label itself.

## See also

- [`custom-openapi-overrides.md`](custom-openapi-overrides.md) — the full `overrideJSONSchema` reference.
- [`responses.md → "OpenAPI emission"`](../responses.md#openapi-emission) — how `@ZodResponse` writes its response card.
