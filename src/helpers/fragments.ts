import type { SchemaObject } from '../schema/openapi.types.js';

/**
 * Common JSON Schema fragment catalog — reusable building blocks for assembling
 * fragments by hand: alongside `z.custom<T>()`, in `overrideJSONSchema` calls,
 * in custom override callbacks, in tests that build expected fragments.
 *
 * The catalog overlaps with what Zod constructs already emit (`z.uuid()` →
 * `uuidFragment` shape, `z.email()` → `emailFragment` shape, etc.) — the
 * helpers don't *replace* those Zod constructs; they're a parallel catalog
 * for programmatic fragment assembly.
 *
 * Each fragment is `as const satisfies SchemaObject` so its literal type
 * powers the dispatch in {@link enrich} — passing wrong-family options
 * fails at compile time.
 */

// ---------------------------------------------------------------------------
// Layer 1 — Fragment catalog
// ---------------------------------------------------------------------------

// String formats (RFC-defined)
export const dateTimeFragment = {
  type: 'string',
  format: 'date-time',
} as const satisfies SchemaObject;
export const dateFragment = { type: 'string', format: 'date' } as const satisfies SchemaObject;
export const timeFragment = { type: 'string', format: 'time' } as const satisfies SchemaObject;
export const uuidFragment = { type: 'string', format: 'uuid' } as const satisfies SchemaObject;
export const emailFragment = { type: 'string', format: 'email' } as const satisfies SchemaObject;
export const uriFragment = { type: 'string', format: 'uri' } as const satisfies SchemaObject;
export const hostnameFragment = {
  type: 'string',
  format: 'hostname',
} as const satisfies SchemaObject;
export const ipv4Fragment = { type: 'string', format: 'ipv4' } as const satisfies SchemaObject;
export const ipv6Fragment = { type: 'string', format: 'ipv6' } as const satisfies SchemaObject;

// Binary / encoded payloads
export const binaryFragment = { type: 'string', format: 'binary' } as const satisfies SchemaObject;
export const byteFragment = { type: 'string', format: 'byte' } as const satisfies SchemaObject;

// Numeric formats (OpenAPI 3.1)
export const int32Fragment = { type: 'integer', format: 'int32' } as const satisfies SchemaObject;
export const int64Fragment = { type: 'integer', format: 'int64' } as const satisfies SchemaObject;
export const floatFragment = { type: 'number', format: 'float' } as const satisfies SchemaObject;
export const doubleFragment = { type: 'number', format: 'double' } as const satisfies SchemaObject;

// Object passthrough
export const opaqueFragment = {
  type: 'object',
  additionalProperties: true,
} as const satisfies SchemaObject;

// ---------------------------------------------------------------------------
// Layer 2 — Per-family option types
// ---------------------------------------------------------------------------

export interface StringFormatOptions {
  description?: string;
  examples?: string[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface BinaryFragmentOptions {
  description?: string;
  contentMediaType?: string;
  contentEncoding?: string;
}

export interface NumberFormatOptions {
  description?: string;
  examples?: number[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export interface OpaqueFragmentOptions {
  description?: string;
}

// ---------------------------------------------------------------------------
// Layer 3 — Type-strict generic enrich
// ---------------------------------------------------------------------------

// `binary` discriminates before the generic string-format branch because its
// option set diverges (contentMediaType / contentEncoding instead of length
// constraints). Order matters here.
type OptionsFor<T> = T extends { readonly format: 'binary' }
  ? BinaryFragmentOptions
  : T extends {
        readonly format:
          | 'date-time'
          | 'date'
          | 'time'
          | 'uuid'
          | 'email'
          | 'uri'
          | 'hostname'
          | 'ipv4'
          | 'ipv6'
          | 'byte';
      }
    ? StringFormatOptions
    : T extends { readonly format: 'int32' | 'int64' | 'float' | 'double' }
      ? NumberFormatOptions
      : T extends { readonly type: 'object'; readonly additionalProperties: true }
        ? OpaqueFragmentOptions
        : never;

/**
 * Merge a catalog fragment with extras whose shape is dictated by the base
 * fragment's family. Passing wrong-family extras (e.g. a `contentMediaType`
 * onto `uuidFragment`) is a compile-time error.
 *
 * Returns a fresh `SchemaObject` — the original fragment is never mutated.
 */
export const enrich = <T extends SchemaObject>(base: T, extras: OptionsFor<T>): SchemaObject => ({
  ...base,
  ...extras,
});

// ---------------------------------------------------------------------------
// Layer 3b — Sugar functions
// ---------------------------------------------------------------------------

/**
 * Binary-content fragment with typed enrichment. Sugar for
 * `enrich(binaryFragment, opts)` — exists because the `binary` option set
 * (`contentMediaType` / `contentEncoding`) is nuanced enough to deserve a
 * dedicated entry point and discoverable via auto-complete.
 *
 * @example
 * overrideJSONSchema(z.instanceof(File), binary());
 * overrideJSONSchema(z.instanceof(File), binary({ contentMediaType: 'application/pdf' }));
 */
export const binary = (opts?: BinaryFragmentOptions): SchemaObject => ({
  ...binaryFragment,
  ...opts,
});

/**
 * Opaque-object fragment with typed enrichment. Sugar for
 * `enrich(opaqueFragment, opts)` — exists for parity with {@link binary}
 * and because opaque passthrough payloads commonly carry a description
 * explaining why the API doesn't introspect them.
 *
 * @example
 * overrideJSONSchema(z.unknown(), opaque({ description: 'JWT passthrough' }));
 */
export const opaque = (opts?: OpaqueFragmentOptions): SchemaObject => ({
  ...opaqueFragment,
  ...opts,
});
