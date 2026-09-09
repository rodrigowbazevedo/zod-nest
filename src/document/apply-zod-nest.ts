import type { OpenAPIObject } from '@nestjs/swagger';
import type { Override } from '../schema/override.js';
import type { ZodNestRegistry } from '../schema/registry.js';
import type { CollectedUsage } from './collect-usage.js';
import type { QueryParamStyle } from './expand-param-markers.js';

import { defaultRegistry } from '../schema/registry.js';
import { relocateExtensionOperations } from './additional-operations.js';
import { bulkEmit } from './bulk-emit.js';
import { collectUsage } from './collect-usage.js';
import { assertNoDanglingRefs } from './dangling-refs.js';
import { expandParamMarkers } from './expand-param-markers.js';
import { extendExposureViaRefs } from './expose-closure.js';
import { inlineAnonymousBodies } from './inline-anon.js';
import { applyItemSchema } from './item-schema.js';
import { mergeSchemas } from './merge-schemas.js';
import { resolveOpenApiVersion } from './openapi-version.js';
import { applyRefTitles } from './ref-titles.js';
import { applyResponseSummary } from './response-summary.js';
import { rewriteRefs } from './rewrite-refs.js';
import { stripMarkers } from './strip-markers.js';

const withForcedExposure = (
  collected: CollectedUsage,
  registry: ZodNestRegistry,
): CollectedUsage => {
  // Exposure is reachability-scoped: only ids actually referenced by this
  // document's endpoints (and their transitive `$ref` deps) are emitted.
  // `{ expose: true }` is the author's explicit opt-in to document a schema
  // that no endpoint references — seed those onto the input side (the default
  // documentation side) so the closure pass pulls in their deps too.
  const forced = registry.forceExposedIds();
  if (forced.length === 0) {
    return collected;
  }
  return {
    inputExposedIds: new Set([...collected.inputExposedIds, ...forced]),
    outputExposedIds: collected.outputExposedIds,
    classToDtoId: collected.classToDtoId,
  };
};

export interface ApplyZodNestOptions {
  /**
   * `ZodNestRegistry` instance that holds the zod-nest DTOs. Defaults to
   * `defaultRegistry` (the process-wide singleton populated by `createZodDto`).
   * Pass an explicit registry for multi-app isolation.
   */
  registry?: ZodNestRegistry;
  /** User override pipe applied on top of the built-in override during emission. */
  override?: Override;
  /**
   * Strict mode (default `true`) throws `ZodNestUnrepresentableError` on
   * unrepresentable Zod constructs (bigint / date / symbol / transform / ...).
   * Set to `false` to emit `{}` for those instead.
   */
  strict?: boolean;
  /**
   * Overrides the version-derived default for named `@Query()` / `@ZodQuery`
   * DTOs: `'expand'` for one parameter per property, `'ref'` to collapse to a
   * single parameter carrying the whole schema.
   *
   * Left unset, 3.2 collapses (as `in: 'querystring'`) and 3.1 expands.
   * Query-only — path / header / cookie DTOs always expand — and a per-handler
   * `@ZodQuery({ ref })` takes precedence.
   *
   * @deprecated Removed in the next major, where 3.1 always expands and 3.2
   * always collapses. This option existed because 3.1 could not express a
   * whole-query-string schema; 3.2's `querystring` can.
   */
  queryParamStyle?: QueryParamStyle;
  /**
   * Copy each named component's `title` (when set via `.meta({ title })`) onto
   * every `$ref` that targets it, as a sibling: `{ $ref, title }` (default
   * `true`).
   *
   * OpenAPI 3.1 allows siblings next to `$ref`, and Swagger UI's 3.1 renderer
   * inlines referenced schemas without showing their component name
   * (swagger-api/swagger-ui#9540); the sibling `title` gives the renderer (and
   * other 3.1-aware tools) a name to display. The annotation is semantically
   * inert. Set `false` to emit bare `$ref`s.
   */
  refTitles?: boolean;
}

/**
 * Post-processor over the OpenAPI document emitted by
 * `SwaggerModule.createDocument`. Mutates the doc in place AND returns it for
 * compositional convenience. After this runs:
 *
 * - Every `components.schemas[<DtoClassName>]` placeholder with an
 *   `x-zod-nest-dto` marker is replaced by the Zod-derived JSON Schema body,
 *   keyed by the marker's `dtoId` (renaming as needed).
 * - Every `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` marker
 *   parameter is expanded into one parameter per top-level property of the
 *   DTO's schema (`expandParamMarkers`) — except named `@Query()` DTOs under
 *   3.2, which collapse to a single `in: 'querystring'` parameter, and their
 *   3.1 equivalent under `queryParamStyle: 'ref'`. The synthetic
 *   `components.schemas.Object` that `@nestjs/swagger` materialises for the
 *   marker placeholder is pruned when it has no remaining referrers.
 * - The I/O suffix truth table is applied — equal input/output bodies collapse
 *   to one `components.schemas[id]`; divergent bodies split as
 *   `id` (input) + `idOutput` (output), with response-side refs rewritten.
 * - Anonymous body/response schemas (no `.meta({ id })`) are inlined at their
 *   `$ref` sites and their synthetic components pruned (`inlineAnonymousBodies`).
 * - Only schemas reachable from this document's endpoints (plus their
 *   transitive `$ref` deps, plus any `{ expose: true }` opt-ins) are kept —
 *   unreferenced registered schemas are pruned. Exposure is document-scoped, so
 *   several documents sharing one registry each carry only what they use.
 * - Each named component's `title` is copied onto every `$ref` that targets it
 *   as a `{ $ref, title }` sibling (`applyRefTitles`, unless `refTitles: false`)
 *   so Swagger UI's 3.1 renderer surfaces the component name. Inert annotation.
 * - Every `$ref` whose target is missing throws `ZodNestDocumentError(DANGLING_REF)`.
 * - `doc.openapi` is normalised to a version zod-nest emits — the one set via
 *   `DocumentBuilder.setOpenAPIVersion()` when supported, else `'3.1.0'` with a
 *   warning, so the version string always matches the emitted body.
 * - Targeting 3.2 additionally moves `search` / WebDAV operations under
 *   `additionalOperations`, the only place that version accepts them, and
 *   rewrites `schema` to `itemSchema` on sequential media types (SSE, NDJSON, …)
 *   so a streamed body documents one item rather than the whole sequence.
 * - Response Object `summary` survives only under 3.2; emitting 3.1 drops each
 *   one with a warning naming the operation, since 3.1 forbids the field.
 * - Under 3.2 a named query DTO collapses to `in: 'querystring'`, degrading to
 *   per-property expansion (with a warning) where that version's coexistence
 *   rules forbid it — a sibling `in: 'query'` parameter, or a second candidate.
 *
 * Composable with other doc-transform passes — apply other mutations before
 * or after this function.
 */
export const applyZodNest = (doc: OpenAPIObject, opts: ApplyZodNestOptions = {}): OpenAPIObject => {
  const registry = opts.registry ?? defaultRegistry;
  // Resolved up front because `expandParamMarkers` branches on it, and once
  // only — it warns on an unsupported version, so a second call would warn twice.
  const openApiVersion = resolveOpenApiVersion(doc);
  const emitThirtyTwo = openApiVersion.startsWith('3.2.');

  const collected = collectUsage(doc, registry);
  // Reachability-scoped exposure: `collectUsage` seeds what the document's
  // endpoints actually reference; `{ expose: true }` opt-ins are added on top.
  const exposed = withForcedExposure(collected, registry);
  const { inputSchemas, outputSchemas } = bulkEmit({
    registry,
    override: opts.override,
    strict: opts.strict,
  });
  const extended = extendExposureViaRefs(exposed, inputSchemas, outputSchemas);
  const { divergentOutputIds, renames } = mergeSchemas({
    doc,
    inputSchemas,
    outputSchemas,
    collected: extended,
    collisions: registry.getCollisions(),
  });
  expandParamMarkers({
    doc,
    inputSchemas,
    outputSchemas,
    queryParamStyle: opts.queryParamStyle,
    emitThirtyTwo,
  });
  rewriteRefs({ doc, renames, divergentOutputIds });
  stripMarkers(doc);
  inlineAnonymousBodies({ doc, registry });
  if (opts.refTitles !== false) {
    applyRefTitles(doc);
  }
  assertNoDanglingRefs({ doc, collected: extended });
  if (emitThirtyTwo) {
    relocateExtensionOperations(doc);
  }
  applyItemSchema(doc, { emit: emitThirtyTwo });
  applyResponseSummary(doc, { emit: emitThirtyTwo });
  doc.openapi = openApiVersion;

  return doc;
};
