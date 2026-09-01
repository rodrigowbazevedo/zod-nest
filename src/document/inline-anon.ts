import type { OpenAPIObject } from '@nestjs/swagger';
import type { ZodNestRegistry } from '../schema/registry.js';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';
import { OUTPUT_SUFFIX } from './constants.js';
import { walkRefs } from './walk-refs.js';

export interface InlineAnonymousBodiesParams {
  /** OpenAPI doc whose anonymous `$ref`s will be inlined in place. */
  doc: OpenAPIObject;
  /** Registry whose `anonymousIds()` identify the synthetic placeholder ids. */
  registry: ZodNestRegistry;
}

// Inlines each anonymous body at its `$ref` site(s) and prunes the component,
// except where one is still referenced. See swagger-integration.md step 7.
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

  // A recursive body refs itself, so inlining it would strand that ref once the
  // component is pruned. Anything still referenced stays a component instead.
  for (const ref of refsWithin(schemas, bodyByRef)) {
    bodyByRef.delete(ref);
  }

  // Inline only within `paths` — the remaining anonymous ids are top-level
  // body/response placeholders, referenced from nowhere else.
  inlineRefs(doc.paths, bodyByRef);

  for (const ref of bodyByRef.keys()) {
    delete schemas[ref.slice(COMPONENTS_SCHEMAS_PREFIX.length)];
  }
};

const refsWithin = (
  schemas: Record<string, unknown>,
  bodyByRef: ReadonlyMap<string, Record<string, unknown>>,
): Set<string> => {
  const found = new Set<string>();
  walkRefs(schemas, (ref) => {
    if (bodyByRef.has(ref)) {
      found.add(ref);
    }
    return undefined;
  });
  return found;
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
