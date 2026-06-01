import 'reflect-metadata';

import { Controller, Get, Header, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const bootstrap = async (
  controllers: Type<unknown>[],
): Promise<{ app: INestApplication; doc: OpenAPIObject }> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  // `@ZodResponse` defers its `@ApiResponse(...)` to a microtask so sibling
  // `@Header` / `@HttpCode` metadata is readable — flush before snapshotting.
  await flushMicrotasks();
  const config = new DocumentBuilder()
    .setTitle('stream')
    .setVersion('0.0.0')
    .setOpenAPIVersion('3.1.0')
    .build();
  const raw = SwaggerModule.createDocument(app, config);
  const doc = applyZodNest(raw, { app });
  return { app, doc };
};

const contentAt = (
  doc: OpenAPIObject,
  path: string,
  status: string,
): Record<string, { schema?: Record<string, unknown> }> => {
  const paths = doc.paths as Record<
    string,
    Record<string, { responses?: Record<string, { content?: unknown }> }>
  >;
  const content = paths?.[path]?.get?.responses?.[status]?.content;
  if (content === undefined || content === null || typeof content !== 'object') {
    throw new Error(`No content for GET ${path} ${status}`);
  }
  return content as Record<string, { schema?: Record<string, unknown> }>;
};

class SseEvent extends createZodDto(z.object({ event: z.string(), data: z.string() }), {
  id: 'Stream_SseEvent',
}) {}
class NdjsonRow extends createZodDto(z.object({ id: z.string(), value: z.number() }), {
  id: 'Stream_NdjsonRow',
}) {}
class Download extends createZodDto(z.object({ bytes: z.number() }), { id: 'Stream_Download' }) {}
class Plain extends createZodDto(z.object({ ok: z.boolean() }), { id: 'Stream_Plain' }) {}

@Controller('stream')
class StreamDocController {
  @Get('sse')
  @ZodResponse({ type: SseEvent, contentType: 'text/event-stream', description: 'SSE stream' })
  sse(): void {}

  @Get('ndjson')
  @ZodResponse({ type: NdjsonRow, contentType: 'application/x-ndjson' })
  ndjson(): void {}

  @Get('header-sse')
  @Header('Content-Type', 'text/event-stream')
  @ZodResponse({ type: SseEvent })
  headerSse(): void {}

  @Get('download')
  @ZodResponse({ type: Download, contentType: 'application/octet-stream' })
  download(): void {}

  @Get('json')
  @ZodResponse({ type: Plain })
  json(): void {}

  @Get('ndjson-array')
  @ZodResponse({ type: [NdjsonRow], contentType: 'application/x-ndjson' })
  ndjsonArray(): void {}

  @Get('tuple-stream')
  @ZodResponse({ type: [SseEvent, NdjsonRow], contentType: 'text/event-stream' })
  tupleStream(): void {}
}

describe('@ZodResponse — streaming content types end-to-end with applyZodNest', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const result = await bootstrap([StreamDocController]);
    app = result.app;
    doc = result.doc;
  });

  afterAll(async () => {
    await app.close();
  });

  it('emits the SSE response under text/event-stream with a $ref to the event component', () => {
    const content = contentAt(doc, '/stream/sse', '200');
    expect(Object.keys(content)).toEqual(['text/event-stream']);
    expect(content['text/event-stream']?.schema).toEqual({
      $ref: '#/components/schemas/Stream_SseEvent',
    });
  });

  it('emits the NDJSON response under application/x-ndjson', () => {
    const content = contentAt(doc, '/stream/ndjson', '200');
    expect(Object.keys(content)).toEqual(['application/x-ndjson']);
    expect(content['application/x-ndjson']?.schema).toEqual({
      $ref: '#/components/schemas/Stream_NdjsonRow',
    });
  });

  it('infers the media type from @Header(Content-Type) when no contentType option is set', () => {
    const content = contentAt(doc, '/stream/header-sse', '200');
    expect(Object.keys(content)).toEqual(['text/event-stream']);
    expect(content['text/event-stream']?.schema).toEqual({
      $ref: '#/components/schemas/Stream_SseEvent',
    });
  });

  it('emits a binary download under application/octet-stream', () => {
    const content = contentAt(doc, '/stream/download', '200');
    expect(Object.keys(content)).toEqual(['application/octet-stream']);
    expect(content['application/octet-stream']?.schema).toEqual({
      $ref: '#/components/schemas/Stream_Download',
    });
  });

  it('emits an array response under a custom content type as array-of-$ref', () => {
    const content = contentAt(doc, '/stream/ndjson-array', '200');
    expect(Object.keys(content)).toEqual(['application/x-ndjson']);
    expect(content['application/x-ndjson']?.schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Stream_NdjsonRow' },
    });
  });

  it('emits a tuple response under a custom content type as prefixItems', () => {
    const content = contentAt(doc, '/stream/tuple-stream', '200');
    expect(Object.keys(content)).toEqual(['text/event-stream']);
    expect(content['text/event-stream']?.schema).toEqual({
      type: 'array',
      prefixItems: [
        { $ref: '#/components/schemas/Stream_SseEvent' },
        { $ref: '#/components/schemas/Stream_NdjsonRow' },
      ],
      items: false,
    });
  });

  it('leaves a plain @ZodResponse on application/json (regression)', () => {
    const content = contentAt(doc, '/stream/json', '200');
    expect(Object.keys(content)).toEqual(['application/json']);
    expect(content['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/Stream_Plain',
    });
  });

  it('emits the referenced DTO schemas into components.schemas with real bodies', () => {
    const schemas = doc.components?.schemas as Record<string, Record<string, unknown>>;
    expect(schemas['Stream_SseEvent']).toBeDefined();
    expect(schemas['Stream_NdjsonRow']).toBeDefined();
    expect(schemas['Stream_Download']).toBeDefined();
    // Real Zod-derived body, not a leftover marker placeholder.
    expect(schemas['Stream_SseEvent']?.type).toBe('object');
    const props = schemas['Stream_SseEvent']?.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['data', 'event']);
  });
});
