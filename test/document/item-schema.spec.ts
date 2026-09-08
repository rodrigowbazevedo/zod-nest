import type { OpenAPIObject } from '@nestjs/swagger';

import { applyItemSchema } from '../../src/document/item-schema.js';
import { OPAQUE_STREAM_MEDIA_TYPES, SEQUENTIAL_MEDIA_TYPES } from '../../src/response/stream.js';
import { ZOD_NEST_ITEM_STREAM_EXTENSION } from '../../src/schema/constants.js';

const EVENT_REF = { $ref: '#/components/schemas/Event' };

const docWith = (operation: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.2.0',
    info: { title: 't', version: 'v' },
    paths: { '/stream': { get: operation } },
  }) as unknown as OpenAPIObject;

const responseDoc = (content: Record<string, unknown>): OpenAPIObject =>
  docWith({ responses: { 200: { description: 'ok', content } } });

const mediaTypeOf = (doc: OpenAPIObject, key: string): Record<string, unknown> => {
  const paths: Record<string, unknown> = doc.paths;
  const found = paths['/stream'];
  if (found === null || typeof found !== 'object') {
    throw new Error('fixture has no /stream path item');
  }
  const { get } = found as {
    get: { responses: Record<string, { content: Record<string, unknown> }> };
  };
  const mediaType = get.responses[200]?.content[key];
  if (mediaType === null || typeof mediaType !== 'object') {
    throw new Error(`fixture has no ${key} media type`);
  }
  return mediaType as Record<string, unknown>;
};

describe('applyItemSchema — sequential media types', () => {
  it.each(SEQUENTIAL_MEDIA_TYPES)('rewrites `schema` to `itemSchema` for %s', (mediaType) => {
    const doc = responseDoc({ [mediaType]: { schema: { ...EVENT_REF } } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, mediaType)).toEqual({ itemSchema: EVENT_REF });
  });

  it('ignores media-type parameters when matching', () => {
    const doc = responseDoc({ 'text/event-stream; charset=utf-8': { schema: { ...EVENT_REF } } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'text/event-stream; charset=utf-8')).toEqual({ itemSchema: EVENT_REF });
  });

  it.each(OPAQUE_STREAM_MEDIA_TYPES)('leaves the opaque stream type %s alone', (mediaType) => {
    const doc = responseDoc({ [mediaType]: { schema: { ...EVENT_REF } } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, mediaType)).toEqual({ schema: EVENT_REF });
  });

  it('leaves a concrete member of an opaque family alone', () => {
    const doc = responseDoc({ 'image/png': { schema: { type: 'string', format: 'binary' } } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'image/png')).toEqual({
      schema: { type: 'string', format: 'binary' },
    });
  });

  it('leaves application/json alone', () => {
    const doc = responseDoc({ 'application/json': { schema: { ...EVENT_REF } } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'application/json')).toEqual({ schema: EVENT_REF });
  });
});

describe('applyItemSchema — array-shaped schemas', () => {
  it('unwraps a bare array into its element schema', () => {
    const doc = responseDoc({
      'application/x-ndjson': { schema: { type: 'array', items: { ...EVENT_REF } } },
    });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'application/x-ndjson')).toEqual({ itemSchema: EVENT_REF });
  });

  it('keeps a `$ref` sibling `title` when unwrapping', () => {
    const doc = responseDoc({
      'application/x-ndjson': {
        schema: { type: 'array', items: { ...EVENT_REF, title: 'Event' } },
      },
    });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'application/x-ndjson')).toEqual({
      itemSchema: { ...EVENT_REF, title: 'Event' },
    });
  });

  it('leaves a bounded array alone — that is already 3.2 "complete content"', () => {
    const bounded = { type: 'array', items: { ...EVENT_REF }, maxItems: 100 };
    const doc = responseDoc({ 'application/jsonl': { schema: { ...bounded } } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'application/jsonl')).toEqual({ schema: bounded });
  });

  it('leaves a tuple alone — it has no single item shape', () => {
    const tuple = { type: 'array', prefixItems: [{ ...EVENT_REF }], items: false };
    const doc = responseDoc({ 'text/event-stream': { schema: { ...tuple } } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'text/event-stream')).toEqual({ schema: tuple });
  });

  it('leaves an array whose `items` is not a schema object alone', () => {
    const doc = responseDoc({ 'text/event-stream': { schema: { type: 'array', items: false } } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'text/event-stream')).toEqual({
      schema: { type: 'array', items: false },
    });
  });
});

describe('applyItemSchema — the custom-stream marker', () => {
  it('rewrites a marked media type that no key would match', () => {
    const doc = responseDoc({
      'text/csv': { schema: { ...EVENT_REF }, [ZOD_NEST_ITEM_STREAM_EXTENSION]: true },
    });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'text/csv')).toEqual({ itemSchema: EVENT_REF });
  });

  it('strips the marker from a sequential type it rewrites anyway', () => {
    const doc = responseDoc({
      'text/event-stream': { schema: { ...EVENT_REF }, [ZOD_NEST_ITEM_STREAM_EXTENSION]: true },
    });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'text/event-stream')).toEqual({ itemSchema: EVENT_REF });
  });

  it('treats a non-`true` marker value as unmarked, and still strips it', () => {
    const doc = responseDoc({
      'text/csv': { schema: { ...EVENT_REF }, [ZOD_NEST_ITEM_STREAM_EXTENSION]: 'yes' },
    });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'text/csv')).toEqual({ schema: EVENT_REF });
  });
});

describe('applyItemSchema — `emit: false` (3.1 targets)', () => {
  it('keeps `schema` on a sequential type', () => {
    const doc = responseDoc({ 'text/event-stream': { schema: { ...EVENT_REF } } });

    applyItemSchema(doc, { emit: false });

    expect(mediaTypeOf(doc, 'text/event-stream')).toEqual({ schema: EVENT_REF });
  });

  it('still strips the marker, which is never valid output', () => {
    const doc = responseDoc({
      'text/csv': { schema: { ...EVENT_REF }, [ZOD_NEST_ITEM_STREAM_EXTENSION]: true },
    });

    applyItemSchema(doc, { emit: false });

    expect(mediaTypeOf(doc, 'text/csv')).toEqual({ schema: EVENT_REF });
  });
});

describe('applyItemSchema — request bodies', () => {
  it('rewrites a streamed upload body', () => {
    const doc = docWith({
      requestBody: { content: { 'application/x-ndjson': { schema: { ...EVENT_REF } } } },
      responses: { 200: { description: 'ok' } },
    });

    const paths: Record<string, unknown> = doc.paths;
    const { get } = paths['/stream'] as {
      get: { requestBody: { content: Record<string, unknown> } };
    };

    applyItemSchema(doc, { emit: true });

    expect(get.requestBody.content['application/x-ndjson']).toEqual({ itemSchema: EVENT_REF });
  });
});

describe('applyItemSchema — malformed documents', () => {
  it.each([
    ['a response set that is not an object', { responses: 'nope' }],
    ['a response that is not an object', { responses: { 200: 'nope' } }],
    ['a response with no content', { responses: { 200: { description: 'ok' } } }],
    ['a content block that is not an object', { responses: { 200: { content: 'nope' } } }],
    ['a media type that is not an object', { responses: { 200: { content: { 'text/csv': 7 } } } }],
    ['a request body that is not an object', { requestBody: 'nope' }],
  ])('walks past %s without throwing', (_label, operation) => {
    const doc = docWith(operation as Record<string, unknown>);

    expect(() => applyItemSchema(doc, { emit: true })).not.toThrow();
  });

  it('leaves a media type with no `schema` alone', () => {
    const doc = responseDoc({ 'text/event-stream': { example: 'data: hi' } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'text/event-stream')).toEqual({ example: 'data: hi' });
  });

  it('leaves a boolean JSON Schema alone', () => {
    const doc = responseDoc({ 'text/event-stream': { schema: true } });

    applyItemSchema(doc, { emit: true });

    expect(mediaTypeOf(doc, 'text/event-stream')).toEqual({ schema: true });
  });
});
