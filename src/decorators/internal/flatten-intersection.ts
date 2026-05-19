import { z } from 'zod';

import type { ZodNestRegistry } from '../../schema/registry.js';

import { discoverDependents } from '../../schema/discover-dependents.js';
import { toOpenApi } from '../../schema/engine.js';
import { ZodNestError } from '../../schema/errors.js';
import { isZodObject } from './zod-param-expand.js';

/**
 * Runtime shape of Zod v4's `$ZodIntersectionDef`. The upstream `.left` /
 * `.right` are typed as Zod's internal `$ZodType` base, not the public
 * `z.ZodType`; the structures are runtime-equivalent. The cast at the
 * boundary keeps the rest of this module on the public type.
 */
interface IntersectionDef {
  readonly type: 'intersection';
  readonly left: z.ZodType;
  readonly right: z.ZodType;
}

const intersectionArms = (
  schema: z.ZodType,
): { readonly left: z.ZodType; readonly right: z.ZodType } | null => {
  if (schema._zod.def.type !== 'intersection') {
    return null;
  }
  // Zod-internal → public-type boundary: `$ZodType` vs `z.ZodType`.
  const def = schema._zod.def as unknown as IntersectionDef;
  return { left: def.left, right: def.right };
};

/**
 * Collect every `z.object` arm from a (possibly nested) intersection. Returns
 * `null` as soon as any arm is not an object — signals "can't flatten" to
 * the caller. Single-object input returns `[schema]` so the caller's no-op
 * path for bare objects is the same code path.
 */
const collectObjectArms = (schema: z.ZodType): z.ZodObject[] | null => {
  if (isZodObject(schema)) {
    return [schema];
  }
  const arms = intersectionArms(schema);
  if (arms === null) {
    return null;
  }
  const left = collectObjectArms(arms.left);
  if (left === null) {
    return null;
  }
  const right = collectObjectArms(arms.right);
  if (right === null) {
    return null;
  }
  return [...left, ...right];
};

/**
 * Merge an intersection of `z.object` arms into a single anonymous
 * `z.object`, emit it inline, and return the JSON Schema body. Used by
 * `@ZodBody({ flatten: true })` so Swagger UI's `multipart/form-data`
 * `try-it-out` form renders correctly — the UI doesn't follow `$ref` or
 * unwrap `allOf`, so it needs a flat object literal at the operation's
 * `schema` site.
 *
 * - Bare `z.object` → single-arm case, emits the same body as the no-flatten
 *   path (no-op for the user).
 * - Nested intersections (`intersection(intersection(A, B), C)`) → all arms
 *   merged in source order.
 * - Property collision → right-arm wins (matches `z.object` spread).
 * - Any non-object arm → throws `ZodNestError`. The flatten helper is only
 *   defined for object intersections; unions / primitives / etc. can't be
 *   represented as a single flat property map.
 *
 * The original schema's `.meta({ id })` is *not* preserved — the merged
 * object is anonymous and lives only in the operation's request body.
 * Per-property `.meta({ id })` schemas keep their `$ref` emission as
 * usual (the merge re-walks named descendants via `discoverDependents`
 * so the registry has them when `toOpenApi` emits).
 */
export const flattenObjectIntersection = (
  schema: z.ZodType,
  registry: ZodNestRegistry,
  decoratorName: string,
): Record<string, unknown> => {
  const arms = collectObjectArms(schema);
  if (arms === null) {
    throw new ZodNestError(
      `${decoratorName} \`flatten: true\` requires the schema to be a \`z.object({...})\` ` +
        `or an intersection whose arms are all object schemas. Drop \`flatten: true\` to ` +
        `emit the original schema with allOf composition.`,
    );
  }
  const mergedShape: Record<string, z.ZodType> = {};
  for (const arm of arms) {
    Object.assign(mergedShape, arm.shape);
  }
  const merged = z.object(mergedShape);
  // Walk named descendants of the *original* schema so per-property $refs
  // resolve when bulk-emit runs. `toOpenApi` below will also register
  // descendants of the merged shape, but the original may carry meta entries
  // on nodes that the merged object's shape doesn't directly reference.
  for (const [child, childId] of discoverDependents(schema)) {
    registry.register(child, childId);
  }
  const { schema: body } = toOpenApi(merged, { io: 'input', registry });
  return body as Record<string, unknown>;
};
