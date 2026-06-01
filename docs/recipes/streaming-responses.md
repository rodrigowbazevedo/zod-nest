# Recipe: Streaming responses (SSE & NDJSON)

Server-Sent Events (`text/event-stream`) and newline-delimited JSON (`application/x-ndjson`) emit many small payloads over one connection. There's no single response body to validate, and the OpenAPI media type must be the stream type — not `application/json`. `@ZodResponse`'s [`contentType` + `stream`](../responses.md#streaming-responses-contenttype--stream) options model both: the DTO describes **one event / line**, the media-type key becomes the stream type, and validation is skipped.

## Server-Sent Events

```ts
import { Controller, Sse } from '@nestjs/common';
import { map } from 'rxjs/operators';
import { z } from 'zod';
import { createZodDto, ZodResponse } from 'zod-nest';

const NotificationEvent = z
  .object({ id: z.string(), kind: z.enum(['info', 'warn']), body: z.string() })
  .meta({ id: 'NotificationEvent' });

export class NotificationEventDto extends createZodDto(NotificationEvent) {}

@Controller('notifications')
export class NotificationsController {
  @Sse('stream')
  @ZodResponse({ type: NotificationEventDto, contentType: 'text/event-stream' })
  stream(): Observable<MessageEvent> {
    return this.events$.pipe(map((event) => ({ data: event }) as MessageEvent));
  }
}
```

The doc gets `responses.200.content['text/event-stream'].schema = { $ref: '#/components/schemas/NotificationEvent' }`, and `stream` defaults to `true` (because `text/event-stream` is a built-in stream type) so the interceptor leaves the `Observable` untouched.

## NDJSON

Either set `contentType` explicitly, or let it infer from a `@Header('Content-Type', …)`:

```ts
import { Controller, Get, Header, Res } from '@nestjs/common';

import type { Response } from 'express';

const ExportRow = z.object({ id: z.string(), value: z.number() }).meta({ id: 'ExportRow' });
export class ExportRowDto extends createZodDto(ExportRow) {}

@Controller('exports')
export class ExportsController {
  @Get('rows')
  @Header('Content-Type', 'application/x-ndjson')
  @ZodResponse({ type: ExportRowDto }) // contentType inferred from the @Header
  rows(@Res() res: Response): void {
    for (const row of this.rows$) {
      res.write(`${JSON.stringify(row)}\n`);
    }
    res.end();
  }
}
```

The `ExportRow` DTO documents the shape of **one line**, mirroring the paginated endpoint's element type — exactly what you'd otherwise hand-write into `@ApiOkResponse({ content: { 'application/x-ndjson': { schema } } })`.

## Notes

- **Union-shaped events.** When each event is one of several shapes — `z.discriminatedUnion('event', […])` — you can't wrap it in `createZodDto` (TS2509). Pass the schema straight to `@ZodResponse({ type: EventSchema, contentType: 'text/event-stream' })`; it's normalised to an output DTO internally. See [responses.md → "Passing a raw schema"](../responses.md).
- **Keep validating?** Set `stream: false` to force validation back on for a stream content type (rare — usually only if you buffer the whole stream and return it as one value).
- **Custom stream types.** To treat an off-list content type (e.g. `text/csv`) as a stream globally, add it to [`ZodNestModuleOptions.streamContentTypes`](../module-options.md#streamcontenttypes) — it merges with the built-in defaults. For a one-off, just pass `stream: true` on that `@ZodResponse`.
- **Binary downloads** (`application/octet-stream`, files) follow the same model — see [`binary-downloads.md`](binary-downloads.md).

## See also

- [`responses.md → "Streaming responses"`](../responses.md#streaming-responses-contenttype--stream) — the option reference.
- [`module-options.md → "streamContentTypes"`](../module-options.md#streamcontenttypes) — extending the stream set.
