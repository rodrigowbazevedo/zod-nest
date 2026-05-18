import type { CollectedUsage } from './collect-usage.js';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';
import { walkRefs } from './walk-refs.js';

/**
 * Closes the input/output exposure sets over `$ref`s. A nested `.meta({ id })`
 * schema declared without `createZodDto` is registered transitively (see
 * `registry.register`) and emitted by `bulkEmit`, but `collectUsage` won't
 * see it directly — it walks request/response bodies and `@ZodResponse`
 * metadata, not nested refs. Without this closure, `mergeSchemas` would
 * skip the nested body, leaving a dangling `$ref` in the final document.
 */
export const extendExposureViaRefs = (
  collected: CollectedUsage,
  inputSchemas: ReadonlyMap<string, unknown>,
  outputSchemas: ReadonlyMap<string, unknown>,
): CollectedUsage => ({
  ...collected,
  inputExposedIds: closeOverRefs(collected.inputExposedIds, inputSchemas),
  outputExposedIds: closeOverRefs(collected.outputExposedIds, outputSchemas),
});

/**
 * BFS over `$ref`s starting from `seed`. For each `#/components/schemas/<id>`
 * encountered in a body, the target id joins the result and its own body is
 * scanned. Refs into other component buckets (`parameters`, `responses`, …)
 * are ignored — exposure closure only governs the schemas bucket. Ids that
 * appear in `seed` but not in `bodies` are kept (they may exist on the
 * other I/O side); they just don't contribute further reachable ids.
 */
export const closeOverRefs = (
  seed: ReadonlySet<string>,
  bodies: ReadonlyMap<string, unknown>,
): Set<string> => {
  const out = new Set(seed);
  const queue = [...seed];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const body = bodies.get(id);
    if (body === undefined) {
      continue;
    }
    walkRefs(body, (ref) => {
      if (!ref.startsWith(COMPONENTS_SCHEMAS_PREFIX)) {
        return undefined;
      }
      const target = ref.slice(COMPONENTS_SCHEMAS_PREFIX.length);
      if (out.has(target)) {
        return undefined;
      }
      out.add(target);
      queue.push(target);
      return undefined;
    });
  }
  return out;
};
