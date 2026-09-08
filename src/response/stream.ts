import { HEADERS_METADATA } from '@nestjs/common/constants.js';

import type { ResponseVariant } from './metadata.js';

/**
 * Media type assumed when `@ZodResponse` declares no `contentType`. Responses
 * at this type carry the standard JSON-validated body and flow through the
 * unchanged `type` / `isArray` swagger path in `applySwaggerResponseDecorator`.
 */
export const DEFAULT_CONTENT_TYPE = 'application/json';

const SEQUENTIAL_DEFAULT_MEDIA_TYPES: readonly string[] = [
  'text/event-stream',
  'application/x-ndjson',
];

/** Every media type OpenAPI 3.2 names as *sequential* — a bare repeating
 * structure, so 3.2 describes one item via `itemSchema` instead of the whole
 * body via `schema`. Beyond the two defaults, reachable by hand-written docs. */
export const SEQUENTIAL_MEDIA_TYPES: readonly string[] = [
  ...SEQUENTIAL_DEFAULT_MEDIA_TYPES,
  'application/jsonl',
  'application/json-seq',
  'application/geo+json-seq',
  'multipart/mixed',
];

/** The stream defaults carrying no per-item schema — opaque bytes, where
 * `itemSchema` is meaningless and must never appear. */
export const OPAQUE_STREAM_MEDIA_TYPES: readonly string[] = [
  'application/octet-stream',
  'application/pdf',
  'image/*',
  'audio/*',
  'video/*',
];

/**
 * Content types whose bodies zod-nest treats as streams by default: the
 * handler writes them straight to the response buffer (SSE, NDJSON, raw
 * binary, files), so `ZodSerializerInterceptor` skips validation and the
 * OpenAPI media-type key becomes the stream type rather than `application/json`.
 *
 * A trailing `/*` marks a family prefix — `image/*` matches `image/png`,
 * `image/jpeg`, … — everything else matches exactly. Consumers extend this set
 * *additively* via `ZodNestModuleOptions.streamContentTypes`; the defaults are
 * always retained so SSE / NDJSON detection can't be accidentally dropped.
 */
export const DEFAULT_STREAM_CONTENT_TYPES: readonly string[] = [
  ...SEQUENTIAL_DEFAULT_MEDIA_TYPES,
  ...OPAQUE_STREAM_MEDIA_TYPES,
];

/**
 * Normalised stream-content-type matcher: exact media types in a `Set` for
 * O(1) lookup, family prefixes (`image/`, …) checked with `startsWith`. Built
 * once by `normalizeStreamMatcher` from the default list (decoration time) or
 * the default ∪ module-configured list (runtime).
 */
export interface StreamContentTypeMatcher {
  exact: ReadonlySet<string>;
  prefixes: readonly string[];
}

const PREFIX_WILDCARD_SUFFIX = '/*';

/**
 * Lowercase a content type and drop any `;`-delimited parameters
 * (`text/event-stream; charset=utf-8` → `text/event-stream`).
 */
const normalizeContentType = (contentType: string): string => {
  const semicolonIndex = contentType.indexOf(';');
  const mediaType = semicolonIndex === -1 ? contentType : contentType.slice(0, semicolonIndex);
  return mediaType.trim().toLowerCase();
};

export const normalizeStreamMatcher = (
  contentTypes: readonly string[],
): StreamContentTypeMatcher => {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const entry of contentTypes) {
    const normalized = normalizeContentType(entry);
    if (normalized.endsWith(PREFIX_WILDCARD_SUFFIX)) {
      // 'image/*' → 'image/' so `startsWith('image/')` matches the family.
      prefixes.push(normalized.slice(0, normalized.length - 1));
      continue;
    }
    if (normalized.endsWith('/')) {
      prefixes.push(normalized);
      continue;
    }
    exact.add(normalized);
  }
  return { exact, prefixes };
};

/** Default matcher used at decoration time, where module options aren't yet available. */
export const DEFAULT_STREAM_MATCHER: StreamContentTypeMatcher = normalizeStreamMatcher(
  DEFAULT_STREAM_CONTENT_TYPES,
);

export const matchesStream = (contentType: string, matcher: StreamContentTypeMatcher): boolean => {
  const normalized = normalizeContentType(contentType);
  if (matcher.exact.has(normalized)) {
    return true;
  }
  for (const prefix of matcher.prefixes) {
    if (normalized.startsWith(prefix)) {
      return true;
    }
  }
  return false;
};

const SEQUENTIAL_MATCHER: StreamContentTypeMatcher = normalizeStreamMatcher(SEQUENTIAL_MEDIA_TYPES);
const OPAQUE_MATCHER: StreamContentTypeMatcher = normalizeStreamMatcher(OPAQUE_STREAM_MEDIA_TYPES);

/** Whether a media-type key names a sequence of items under 3.2. Keyed on the
 * type alone, so it also classifies hand-written `@ApiResponse` content. */
export const isSequentialMediaType = (contentType: string): boolean =>
  matchesStream(contentType, SEQUENTIAL_MATCHER);

/** Whether a variant is a *custom* item stream — an explicit `stream: true` on a
 * type that is neither already sequential (the document pass matches those by
 * key) nor opaque bytes. Such a media type gets marked for that pass. */
export const isItemStreamVariant = (variant: ResponseVariant, contentType: string): boolean => {
  if (variant.stream !== true) {
    return false;
  }
  if (isSequentialMediaType(contentType)) {
    return false;
  }
  return !matchesStream(contentType, OPAQUE_MATCHER);
};

interface HeaderMetadataEntry {
  name: string;
  value: unknown;
}

const isHeaderEntry = (value: unknown): value is HeaderMetadataEntry => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return 'name' in value && typeof value.name === 'string';
};

/**
 * Read the `Content-Type` value declared via `@Header('Content-Type', …)` on a
 * handler. NestJS stores `[{ name, value }]` under `HEADERS_METADATA`; thunk
 * values (`@Header('Content-Type', () => …)`) are ignored — only literal
 * strings can be resolved statically.
 */
const headerContentType = (handler: object): string | undefined => {
  const headers = Reflect.getMetadata(HEADERS_METADATA, handler);
  if (!Array.isArray(headers)) {
    return undefined;
  }
  for (const entry of headers) {
    if (!isHeaderEntry(entry)) {
      continue;
    }
    if (entry.name.toLowerCase() !== 'content-type') {
      continue;
    }
    if (typeof entry.value !== 'string') {
      continue;
    }
    return entry.value;
  }
  return undefined;
};

/**
 * Resolve the effective response content type for a variant. Precedence:
 * 1. explicit `contentType` option (returned verbatim);
 * 2. a `@Header('Content-Type', …)` value, but only when it matches a known
 *    stream type (so an arbitrary header doesn't silently rewrite the doc);
 * 3. `application/json`.
 */
export const resolveContentType = (
  variant: ResponseVariant,
  handler: object,
  matcher: StreamContentTypeMatcher,
): string => {
  if (variant.contentType !== undefined) {
    return variant.contentType;
  }
  const fromHeader = headerContentType(handler);
  if (fromHeader !== undefined && matchesStream(fromHeader, matcher)) {
    return normalizeContentType(fromHeader);
  }
  return DEFAULT_CONTENT_TYPE;
};

/**
 * Whether a response variant should be treated as a stream — i.e. written
 * directly to the buffer and *not* validated. Explicit `stream` wins; otherwise
 * the effective content type is matched against the known stream set.
 */
export const isStreamResponse = (
  variant: ResponseVariant,
  handler: object,
  matcher: StreamContentTypeMatcher,
): boolean => {
  if (variant.stream !== undefined) {
    return variant.stream;
  }
  return matchesStream(resolveContentType(variant, handler, matcher), matcher);
};
