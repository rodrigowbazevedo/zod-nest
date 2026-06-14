import type { OpenAPIObject } from '@nestjs/swagger';
import type { ZodNestRegistry } from '../schema/registry.js';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';
import { OUTPUT_SUFFIX } from './constants.js';

export interface InlineAnonymousBodiesParams {
  /** OpenAPI doc whose anonymous `$ref`s will be inlined in place. */
  doc: OpenAPIObject;
  /** Registry whose `anonymousIds()` identify the synthetic placeholder ids. */
  registry: ZodNestRegistry;
}

/**
 * Inlines every anonymous schema's body at its `$ref` site(s) and prunes the
 * synthetic component. An anonymous id is the placeholder minted for a schema
 * passed inline to `@ZodResponse` / `@ZodBody` with no resolvable id; it exists
 * only to carry the body through `bulkEmit` (so the body honors the document's
 * `strict` / `override`). By the time this runs the body has been written to
 * `components.schemas[id]` and cleaned by `stripMarkers`, so we clone it into
 * each referrer and drop the component.
 *
 * Runs after `mergeSchemas` + `rewriteRefs` + `stripMarkers`, before
 * `assertNoDanglingRefs`. The inlined body's nested member `$ref`s point at
 * real, exposed components (closed over by `extendExposureViaRefs`), so the
 * dangling-ref assertion still passes.
 *
 * A reused anonymous instance (same schema across N referrers) has its body
 * duplicated at each site — the author adds `.meta({ id })` to share it as a
 * named component instead. Both the canonical id and its divergent
 * `<id>Output` sibling (if input/output diverged) are inlined and pruned.
 */
export const inlineAnonymousBodies = ({ doc, registry }: InlineAnonymousBodiesParams): void => {
  const anonIds = registry.anonymousIds();
  if (anonIds.length === 0) {
    return;
  }
  const schemas = doc.components?.schemas;
  if (schemas === undefined) {
    return;
  }

  // Map each anonymous `$ref` string to the body it should be replaced with.
  // Include the `<id>Output` sibling so a schema used on both the input and
  // output side (and split by the I/O truth table) is inlined on both.
  const bodyByRef = new Map<string, Record<string, unknown>>();
  for (const anonId of anonIds) {
    for (const key of [anonId, `${anonId}${OUTPUT_SUFFIX}`]) {
      const body = schemas[key];
      if (isPlainRecord(body)) {
        bodyByRef.set(`${COMPONENTS_SCHEMAS_PREFIX}${key}`, body);
      }
    }
  }
  if (bodyByRef.size === 0) {
    return;
  }

  // Inline only within `paths` — anonymous ids are top-level body/response
  // placeholders, never referenced from another component schema.
  inlineRefs(doc.paths, bodyByRef);

  for (const ref of bodyByRef.keys()) {
    delete schemas[ref.slice(COMPONENTS_SCHEMAS_PREFIX.length)];
  }
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Replaces every `{ $ref }` node whose target is in `bodyByRef` with a deep
 * clone of the body, in place. Does not recurse into a freshly-inlined body —
 * its refs are real member refs that must stay as `$ref`s.
 */
const inlineRefs = (
  node: unknown,
  bodyByRef: ReadonlyMap<string, Record<string, unknown>>,
): void => {
  if (Array.isArray(node)) {
    for (const item of node) {
      inlineRefs(item, bodyByRef);
    }
    return;
  }
  if (!isPlainRecord(node)) {
    return;
  }
  const ref = node.$ref;
  if (typeof ref === 'string') {
    const body = bodyByRef.get(ref);
    if (body !== undefined) {
      for (const key of Object.keys(node)) {
        delete node[key];
      }
      Object.assign(node, structuredClone(body));
      return;
    }
  }
  for (const value of Object.values(node)) {
    inlineRefs(value, bodyByRef);
  }
};
