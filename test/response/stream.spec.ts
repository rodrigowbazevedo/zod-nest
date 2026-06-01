import 'reflect-metadata';

import { Header } from '@nestjs/common';
import { z } from 'zod';

import type { ResponseVariant } from '../../src/response/metadata.js';

import { createZodDto } from '../../src';
import {
  DEFAULT_CONTENT_TYPE,
  DEFAULT_STREAM_CONTENT_TYPES,
  DEFAULT_STREAM_MATCHER,
  isStreamResponse,
  matchesStream,
  normalizeStreamMatcher,
  resolveContentType,
} from '../../src/response/stream.js';

class StreamUnitDto extends createZodDto(z.object({ id: z.string() }), { id: 'StreamUnitDto' }) {}

const makeVariant = (overrides: Partial<ResponseVariant> = {}): ResponseVariant => ({
  status: 200,
  kind: 'single',
  dto: StreamUnitDto,
  validationSchema: StreamUnitDto.schema,
  passthroughOnError: false,
  ...overrides,
});

// Real @Header-decorated handlers so we exercise the actual HEADERS_METADATA shape.
class HeaderController {
  @Header('Content-Type', 'text/event-stream')
  sse(): void {}

  @Header('Content-Type', 'application/x-ndjson; charset=utf-8')
  ndjsonWithParams(): void {}

  @Header('Content-Type', 'application/json')
  json(): void {}

  @Header('X-Custom', 'whatever')
  noContentType(): void {}

  plain(): void {}
}

describe('DEFAULT_STREAM_CONTENT_TYPES', () => {
  it('includes the SSE, NDJSON, binary and media-family defaults', () => {
    expect(DEFAULT_STREAM_CONTENT_TYPES).toEqual([
      'text/event-stream',
      'application/x-ndjson',
      'application/octet-stream',
      'application/pdf',
      'image/*',
      'audio/*',
      'video/*',
    ]);
  });
});

describe('normalizeStreamMatcher', () => {
  it('splits exact media types from family prefixes', () => {
    const matcher = normalizeStreamMatcher(['text/event-stream', 'image/*', 'audio/']);
    expect(matcher.exact.has('text/event-stream')).toBe(true);
    expect(matcher.prefixes).toContain('image/');
    expect(matcher.prefixes).toContain('audio/');
  });

  it('lowercases and strips parameters from entries', () => {
    const matcher = normalizeStreamMatcher(['TEXT/Event-Stream; charset=utf-8']);
    expect(matcher.exact.has('text/event-stream')).toBe(true);
  });
});

describe('matchesStream', () => {
  it('matches exact stream content types', () => {
    expect(matchesStream('application/x-ndjson', DEFAULT_STREAM_MATCHER)).toBe(true);
    expect(matchesStream('application/octet-stream', DEFAULT_STREAM_MATCHER)).toBe(true);
  });

  it('matches a media family via prefix', () => {
    expect(matchesStream('image/png', DEFAULT_STREAM_MATCHER)).toBe(true);
    expect(matchesStream('video/mp4', DEFAULT_STREAM_MATCHER)).toBe(true);
  });

  it('is case-insensitive and ignores parameters', () => {
    expect(matchesStream('Text/Event-Stream; charset=utf-8', DEFAULT_STREAM_MATCHER)).toBe(true);
  });

  it('does not match application/json or unknown types', () => {
    expect(matchesStream('application/json', DEFAULT_STREAM_MATCHER)).toBe(false);
    expect(matchesStream('text/plain', DEFAULT_STREAM_MATCHER)).toBe(false);
  });
});

describe('resolveContentType', () => {
  it('returns the explicit contentType verbatim', () => {
    const variant = makeVariant({ contentType: 'text/event-stream' });
    expect(
      resolveContentType(variant, HeaderController.prototype.json, DEFAULT_STREAM_MATCHER),
    ).toBe('text/event-stream');
  });

  it('adopts a stream-typed @Header when no contentType is set', () => {
    const variant = makeVariant();
    expect(
      resolveContentType(variant, HeaderController.prototype.sse, DEFAULT_STREAM_MATCHER),
    ).toBe('text/event-stream');
  });

  it('normalizes the adopted @Header value (strips params)', () => {
    const variant = makeVariant();
    expect(
      resolveContentType(
        variant,
        HeaderController.prototype.ndjsonWithParams,
        DEFAULT_STREAM_MATCHER,
      ),
    ).toBe('application/x-ndjson');
  });

  it('ignores a non-stream @Header and falls back to application/json', () => {
    const variant = makeVariant();
    expect(
      resolveContentType(variant, HeaderController.prototype.json, DEFAULT_STREAM_MATCHER),
    ).toBe(DEFAULT_CONTENT_TYPE);
  });

  it('falls back to application/json when there is no Content-Type header', () => {
    const variant = makeVariant();
    expect(
      resolveContentType(variant, HeaderController.prototype.noContentType, DEFAULT_STREAM_MATCHER),
    ).toBe(DEFAULT_CONTENT_TYPE);
    expect(
      resolveContentType(variant, HeaderController.prototype.plain, DEFAULT_STREAM_MATCHER),
    ).toBe(DEFAULT_CONTENT_TYPE);
  });
});

describe('isStreamResponse', () => {
  it('honours an explicit stream: true', () => {
    const variant = makeVariant({ stream: true });
    expect(isStreamResponse(variant, HeaderController.prototype.json, DEFAULT_STREAM_MATCHER)).toBe(
      true,
    );
  });

  it('honours an explicit stream: false even for a stream content type', () => {
    const variant = makeVariant({ stream: false, contentType: 'text/event-stream' });
    expect(
      isStreamResponse(variant, HeaderController.prototype.plain, DEFAULT_STREAM_MATCHER),
    ).toBe(false);
  });

  it('infers true from a stream contentType option', () => {
    const variant = makeVariant({ contentType: 'application/octet-stream' });
    expect(
      isStreamResponse(variant, HeaderController.prototype.plain, DEFAULT_STREAM_MATCHER),
    ).toBe(true);
  });

  it('infers true from a stream-typed @Header', () => {
    const variant = makeVariant();
    expect(isStreamResponse(variant, HeaderController.prototype.sse, DEFAULT_STREAM_MATCHER)).toBe(
      true,
    );
  });

  it('infers false for a plain JSON response', () => {
    const variant = makeVariant();
    expect(isStreamResponse(variant, HeaderController.prototype.json, DEFAULT_STREAM_MATCHER)).toBe(
      false,
    );
  });

  it('respects a custom matcher that adds a new stream type', () => {
    const matcher = normalizeStreamMatcher([...DEFAULT_STREAM_CONTENT_TYPES, 'text/csv']);
    const variant = makeVariant({ contentType: 'text/csv' });
    expect(isStreamResponse(variant, HeaderController.prototype.plain, matcher)).toBe(true);
    // The default matcher still treats it as a normal validated body.
    expect(
      isStreamResponse(variant, HeaderController.prototype.plain, DEFAULT_STREAM_MATCHER),
    ).toBe(false);
  });
});
