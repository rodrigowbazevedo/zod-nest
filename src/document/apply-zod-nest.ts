import type { OpenAPIObject } from '@nestjs/swagger';
import type { Override } from '../schema/override.js';
import type { ZodNestRegistry } from '../schema/registry.js';
import type { CollectedUsage } from './collect-usage.js';
import type { QueryParamStyle } from './expand-param-markers.js';

import { defaultRegistry } from '../schema/registry.js';
import { bulkEmit } from './bulk-emit.js';
import { collectUsage } from './collect-usage.js';
import { assertNoDanglingRefs } from './dangling-refs.js';
import { expandParamMarkers } from './expand-param-markers.js';
import { extendExposureViaRefs } from './expose-closure.js';
import { inlineAnonymousBodies } from './inline-anon.js';
import { mergeSchemas } from './merge-schemas.js';
import { applyRefTitles } from './ref-titles.js';
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

const OPENAPI_VERSION = '3.1.0';

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
   * How named `@Query()` / `@ZodQuery` DTOs are represented in the document
   * (default `'expand'`):
   *
   * - `'expand'` — one query parameter per top-level property of the DTO.
   * - `'ref'` — a single schema-based query parameter referencing the DTO's
   *   `components.schemas` entry (`style: 'form'`, `explode: true`). The wire
   *   format is unchanged; only the spec representation collapses to the
   *   shared component. Note: Swagger UI renders the two forms differently.
   *
   * Query-only — path / header / cookie DTOs always expand. A per-handler
   * `@ZodQuery({ ref })` override takes precedence over this preference.
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
 *   DTO's schema (`expandParamMarkers`) — except `@Query()` DTOs under
 *   `queryParamStyle: 'ref'` (or a `@ZodQuery({ ref: true })` override), which
 *   collapse to a single `$ref` schema-based query parameter. The synthetic
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
 * - `doc.openapi` is set to `'3.1.0'` — zod-nest emits OpenAPI 3.1 only; this
 *   guarantees the version string matches the emitted body regardless of the
 *   `DocumentBuilder` configuration on the caller side.
 *
 * Composable with other doc-transform passes — apply other mutations before
 * or after this function.
 */
export const applyZodNest = (doc: OpenAPIObject, opts: ApplyZodNestOptions = {}): OpenAPIObject => {
  const registry = opts.registry ?? defaultRegistry;

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
  expandParamMarkers({ doc, inputSchemas, outputSchemas, queryParamStyle: opts.queryParamStyle });
  rewriteRefs({ doc, renames, divergentOutputIds });
  stripMarkers(doc);
  inlineAnonymousBodies({ doc, registry });
  if (opts.refTitles !== false) {
    applyRefTitles(doc);
  }
  assertNoDanglingRefs({ doc, collected: extended });
  doc.openapi = OPENAPI_VERSION;

  return doc;
};
