import type { OpenAPIObject } from '@nestjs/swagger';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';
import { OUTPUT_SUFFIX } from './constants.js';
import { HTTP_METHODS } from './http-methods.js';
import { walkRefs } from './walk-refs.js';

export interface RewriteRefsParams {
  doc: OpenAPIObject;
  /** className → dtoId map from `mergeSchemas`. */
  renames: ReadonlyMap<string, string>;
  /** dtoIds whose output emission landed at `<id>Output`. */
  divergentOutputIds: ReadonlySet<string>;
}

/**
 * Single rewrite pass over the doc:
 *
 * 1. **Rename pass (whole doc)** — any `$ref` whose target id is in
 *    `renames` gets rewritten from `#/components/schemas/<className>` to
 *    `#/components/schemas/<dtoId>`. This applies in operations, parameters,
 *    requestBody, responses, nested schemas, anywhere.
 * 2. **Output-suffix pass (responses only)** — within
 *    `paths.*.{op}.responses.*`, any `$ref` whose (post-rename) target id
 *    is in `divergentOutputIds` gets rewritten to
 *    `#/components/schemas/<id>Output`. Scoped to response sub-trees so
 *    input-side refs to the same id keep pointing at the canonical id.
 *
 * Ordering is significant: pass 1 runs first so pass 2 sees already-renamed
 * (dtoId-keyed) refs and only matches against `divergentOutputIds`.
 */
export const rewriteRefs = (params: RewriteRefsParams): void => {
  const { doc, renames, divergentOutputIds } = params;

  if (renames.size > 0) {
    walkRefs(doc, (ref) => {
      if (!ref.startsWith(COMPONENTS_SCHEMAS_PREFIX)) {
        return undefined;
      }
      const target = ref.slice(COMPONENTS_SCHEMAS_PREFIX.length);
      const renamed = renames.get(target);
      if (renamed === undefined) {
        return undefined;
      }
      return `${COMPONENTS_SCHEMAS_PREFIX}${renamed}`;
    });
  }

  if (divergentOutputIds.size === 0) {
    return;
  }

  const paths = doc.paths ?? {};
  for (const pathItem of Object.values(paths)) {
    if (pathItem === null || typeof pathItem !== 'object') {
      continue;
    }
    rewriteResponseSubtree(pathItem as Record<string, unknown>, divergentOutputIds);
  }
};

const rewriteResponseSubtree = (
  pathItem: Record<string, unknown>,
  divergentOutputIds: ReadonlySet<string>,
): void => {
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (op === null || typeof op !== 'object') {
      continue;
    }
    const responses = (op as { responses?: unknown }).responses;
    if (responses === null || typeof responses !== 'object') {
      continue;
    }
    walkRefs(responses, (ref) => {
      if (!ref.startsWith(COMPONENTS_SCHEMAS_PREFIX)) {
        return undefined;
      }
      const target = ref.slice(COMPONENTS_SCHEMAS_PREFIX.length);
      if (!divergentOutputIds.has(target)) {
        return undefined;
      }
      return `${COMPONENTS_SCHEMAS_PREFIX}${target}${OUTPUT_SUFFIX}`;
    });
  }
};
