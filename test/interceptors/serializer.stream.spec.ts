import 'reflect-metadata';

import { Get, Header } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';
import { ZodSerializationException } from '../../src/exceptions/serialization.exception.js';
import { ZodSerializerInterceptor } from '../../src/interceptors/serializer.interceptor.js';
import { normalizeZodNestOptions } from '../../src/module/options.js';
import { collect, makeContext, makeNext } from './helpers.js';

// `msg` is uppercased on validation — a value that survives unchanged proves
// the schema never ran (the stream path skipped it).
class EventDto extends createZodDto(
  z.object({ id: z.string(), msg: z.string().transform((v) => v.toUpperCase()) }),
  { id: 'Stream_Event' },
) {}

class StreamController {
  @Get('sse')
  @Header('Content-Type', 'text/event-stream')
  @ZodResponse({ type: EventDto })
  sse(): void {}

  @Get('ndjson')
  @ZodResponse({ type: EventDto, contentType: 'application/x-ndjson' })
  ndjson(): void {}

  @Get('explicit-stream')
  @ZodResponse({ type: EventDto, stream: true })
  explicitStream(): void {}

  @Get('opt-out')
  @ZodResponse({ type: EventDto, contentType: 'text/event-stream', stream: false })
  optOut(): void {}

  @Get('json')
  @ZodResponse({ type: EventDto })
  json(): void {}

  @Get('csv')
  @ZodResponse({ type: EventDto, contentType: 'text/csv' })
  csv(): void {}
}

describe('ZodSerializerInterceptor — stream responses skip validation', () => {
  const interceptor = new ZodSerializerInterceptor(new Reflector());

  // A payload that would FAIL EventDto validation — if it passes through
  // unchanged, the stream path skipped validation entirely.
  const invalidBody = { not: 'an event' };

  it('skips validation when @Header(Content-Type) is a stream type', async () => {
    const ctx = makeContext({ statusCode: 200, handler: StreamController.prototype.sse });
    const result = await collect(interceptor.intercept(ctx, makeNext(invalidBody)));
    expect(result).toBe(invalidBody);
  });

  it('skips validation for a stream-typed contentType option', async () => {
    const ctx = makeContext({ statusCode: 200, handler: StreamController.prototype.ndjson });
    const result = await collect(interceptor.intercept(ctx, makeNext(invalidBody)));
    expect(result).toBe(invalidBody);
  });

  it('skips validation for an explicit stream: true', async () => {
    const ctx = makeContext({
      statusCode: 200,
      handler: StreamController.prototype.explicitStream,
    });
    const result = await collect(interceptor.intercept(ctx, makeNext(invalidBody)));
    expect(result).toBe(invalidBody);
  });

  it('explicit stream: false re-enables validation even for a stream content type', async () => {
    const ctx = makeContext({ statusCode: 200, handler: StreamController.prototype.optOut });
    await expect(collect(interceptor.intercept(ctx, makeNext(invalidBody)))).rejects.toBeInstanceOf(
      ZodSerializationException,
    );
  });

  it('still validates a plain application/json response (control)', async () => {
    const ctx = makeContext({ statusCode: 200, handler: StreamController.prototype.json });
    await expect(collect(interceptor.intercept(ctx, makeNext(invalidBody)))).rejects.toBeInstanceOf(
      ZodSerializationException,
    );
  });

  it('still transforms a valid streamed value? no — it passes through verbatim', async () => {
    // Even a structurally-valid body is returned untouched (no transform) when
    // streaming: the interceptor never calls the schema.
    const ctx = makeContext({ statusCode: 200, handler: StreamController.prototype.sse });
    const valid = { id: 'e1', msg: 'lower' };
    const result = await collect(interceptor.intercept(ctx, makeNext(valid)));
    expect(result).toBe(valid);
    expect((result as { msg: string }).msg).toBe('lower');
  });
});

describe('ZodSerializerInterceptor — module streamContentTypes extends runtime detection', () => {
  it('a default interceptor validates an off-list content type (text/csv)', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const ctx = makeContext({ statusCode: 200, handler: StreamController.prototype.csv });
    await expect(
      collect(interceptor.intercept(ctx, makeNext({ not: 'an event' }))),
    ).rejects.toBeInstanceOf(ZodSerializationException);
  });

  it('an interceptor configured with streamContentTypes skips it', async () => {
    const options = normalizeZodNestOptions({ streamContentTypes: ['text/csv'] });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), options);
    const ctx = makeContext({ statusCode: 200, handler: StreamController.prototype.csv });
    const body = { not: 'an event' };
    const result = await collect(interceptor.intercept(ctx, makeNext(body)));
    expect(result).toBe(body);
  });
});
