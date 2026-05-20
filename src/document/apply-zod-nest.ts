import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { Override } from '../schema/override.js';
import type { ZodNestRegistry } from '../schema/registry.js';
import type { CollectedUsage } from './collect-usage.js';

import { defaultRegistry } from '../schema/registry.js';
import { bulkEmit } from './bulk-emit.js';
import { collectUsage } from './collect-usage.js';
import { assertNoDanglingRefs } from './dangling-refs.js';
import { expandParamMarkers } from './expand-param-markers.js';
import { extendExposureViaRefs } from './expose-closure.js';
import { mergeSchemas } from './merge-schemas.js';
import { rewriteRefs } from './rewrite-refs.js';
import { stripMarkers } from './strip-markers.js';

const withRegistryExposure = (
  collected: CollectedUsage,
  registry: ZodNestRegistry,
): CollectedUsage => {
  // Default-expose any registered id that no other mechanism has already
  // exposed. Schemas already in `inputExposedIds` (doc refs, marker params)
  // or `outputExposedIds` (`@ZodResponse` metadata) are left alone — the
  // truth table in `mergeSchemas` is calibrated around the directional
  // exposure for those, and forcing them into both sides would cause input
  // /output divergence to split a previously-single-form emission into
  // `Id` + `IdOutput` for response-only DTOs.
  //
  // Newly-exposed ids land in `inputExposedIds` — the default side for
  // documentation purposes. The "input" form is permissive (`additionalProperties: true`
  // on object schemas), which is the more general representation when no
  // usage context says otherwise.
  const alreadyExposed = new Set([...collected.inputExposedIds, ...collected.outputExposedIds]);
  const extras = registry.ids().filter((id) => !alreadyExposed.has(id));
  if (extras.length === 0) {
    return collected;
  }
  return {
    inputExposedIds: new Set([...collected.inputExposedIds, ...extras]),
    outputExposedIds: collected.outputExposedIds,
    classToDtoId: collected.classToDtoId,
  };
};

const OPENAPI_VERSION = '3.1.0';

export interface ApplyZodNestOptions {
  /**
   * The NestJS app instance. Required so `applyZodNest` can walk controllers
   * via `DiscoveryService` to pick up `@ZodResponse` output-side DTO usage —
   * `@nestjs/swagger` is currently anemic on response shapes.
   */
  app: INestApplication;
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
 *   DTO's schema (`expandParamMarkers`). The synthetic `components.schemas.Object`
 *   that `@nestjs/swagger` materialises for the marker placeholder is pruned
 *   when it has no remaining referrers.
 * - The I/O suffix truth table is applied — equal input/output bodies collapse
 *   to one `components.schemas[id]`; divergent bodies split as
 *   `id` (input) + `idOutput` (output), with response-side refs rewritten.
 * - Every `$ref` whose target is missing throws `ZodNestDocumentError(DANGLING_REF)`.
 * - `doc.openapi` is set to `'3.1.0'` — zod-nest emits OpenAPI 3.1 only; this
 *   guarantees the version string matches the emitted body regardless of the
 *   `DocumentBuilder` configuration on the caller side.
 *
 * Composable with other doc-transform passes — apply other mutations before
 * or after this function. The `app` argument is required because the
 * output-side DTO usage lives on controller-method metadata that the doc
 * doesn't surface; `DiscoveryService` resolves it.
 */
export const applyZodNest = (doc: OpenAPIObject, opts: ApplyZodNestOptions): OpenAPIObject => {
  const registry = opts.registry ?? defaultRegistry;

  const collected = collectUsage(doc, opts.app, registry);
  // Every id in the registry is exposed by default — calling `registerSchema`
  // (directly, or transitively via `createZodDto` / `@ZodBody` / `extend` /
  // descendant discovery) is the user's stated intent to document the schema.
  // Doc-walked refs and `@ZodResponse` metadata are additive on top.
  const exposed = withRegistryExposure(collected, registry);
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
  expandParamMarkers({ doc, inputSchemas, outputSchemas });
  rewriteRefs({ doc, renames, divergentOutputIds });
  stripMarkers(doc);
  assertNoDanglingRefs({ doc, collected: extended });
  doc.openapi = OPENAPI_VERSION;

  return doc;
};
