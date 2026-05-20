import { z } from 'zod';

import type { ZodNestRegistry } from '../../schema/registry.js';

import { discoverDependents } from '../../schema/discover-dependents.js';
import { toOpenApi } from '../../schema/engine.js';
import { ZodNestError } from '../../schema/errors.js';
import { registerSchema } from '../../schema/registry.js';
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

interface UnionDef {
  readonly type: 'union';
  readonly options: ReadonlyArray<z.ZodType>;
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

const unionOptions = (schema: z.ZodType): ReadonlyArray<z.ZodType> | null => {
  if (schema._zod.def.type !== 'union') {
    return null;
  }
  // Zod-internal → public-type boundary. `discriminatedUnion` also uses
  // `type: 'union'` and shares the `options` field shape.
  const def = schema._zod.def as unknown as UnionDef;
  return def.options;
};

interface CollectedShapes {
  readonly shapes: ReadonlyArray<Record<string, z.ZodType>>;
  /**
   * `true` when the walk traversed a union arm at any depth — signals that
   * the merged shape should mark all properties optional, since no single
   * property is guaranteed across the original variants.
   */
  readonly unionCrossed: boolean;
}

/**
 * Walk an intersection / union tree and collect every `z.object` shape
 * reachable. Returns `null` as soon as a non-object leaf is hit (a
 * primitive, a tuple, a transform — anything that isn't an object and
 * isn't a composite of objects). Single-object input returns one shape.
 */
const collectObjectShapes = (schema: z.ZodType): CollectedShapes | null => {
  if (isZodObject(schema)) {
    return { shapes: [schema.shape], unionCrossed: false };
  }
  const options = unionOptions(schema);
  if (options !== null) {
    const allShapes: Array<Record<string, z.ZodType>> = [];
    for (const variant of options) {
      const variantResult = collectObjectShapes(variant);
      if (variantResult === null) {
        return null;
      }
      allShapes.push(...variantResult.shapes);
    }
    return { shapes: allShapes, unionCrossed: true };
  }
  const arms = intersectionArms(schema);
  if (arms === null) {
    return null;
  }
  const left = collectObjectShapes(arms.left);
  if (left === null) {
    return null;
  }
  const right = collectObjectShapes(arms.right);
  if (right === null) {
    return null;
  }
  return {
    shapes: [...left.shapes, ...right.shapes],
    unionCrossed: left.unionCrossed || right.unionCrossed,
  };
};

/**
 * Merge an intersection / union tree of `z.object` arms into a single
 * anonymous `z.object`, emit it inline, and return the JSON Schema body.
 * Used by `@ZodBody({ flatten: true })` so Swagger UI's
 * `multipart/form-data` `try-it-out` form renders correctly — the UI
 * doesn't follow `$ref` or unwrap `allOf` / `oneOf`, so it needs a flat
 * object literal at the operation's `schema` site.
 *
 * Supported shapes:
 * - `z.object({...})` — single-arm case, identity merge.
 * - `z.intersection(obj, obj)` — merges both arms' properties.
 * - Nested intersections (`intersection(intersection(A, B), C)`) — all
 *   reachable arms merged in source order.
 * - `z.union([obj, obj, ...])` / `z.discriminatedUnion(...)` — merges all
 *   variant properties. **All merged properties become optional** because
 *   no single property is guaranteed across the original variants.
 * - `intersection(union(...), union(...))` — combines the above; any
 *   property reachable through a union is optional in the result.
 *
 * Rejected shapes (throws `ZodNestError`):
 * - Any non-object leaf at any depth: primitives, tuples, transforms,
 *   nullable/optional wrappers around non-objects.
 *
 * Behavior details:
 * - Property collisions resolve right-arm-wins (mirrors `z.object`'s spread
 *   semantics; for unions, later variants override earlier ones).
 * - The original schema's `.meta({ id })` on the root is *not* preserved —
 *   the merged object is anonymous and lives only in the operation body.
 * - Per-property `.meta({ id })` schemas keep their `$ref` emission via
 *   normal `toOpenApi` traversal.
 * - The spec emission becomes less precise (a union arm's "you must supply
 *   variant A or variant B" becomes "any subset of all variants' fields").
 *   This is the documented trade-off for Swagger UI compatibility — runtime
 *   validation via `ZodValidationPipe(originalSchema)` still enforces the
 *   precise shape.
 */
export const flattenObjectIntersection = (
  schema: z.ZodType,
  registry: ZodNestRegistry,
  decoratorName: string,
): Record<string, unknown> => {
  const collected = collectObjectShapes(schema);
  if (collected === null) {
    throw new ZodNestError(
      `${decoratorName} \`flatten: true\` requires every leaf of the schema to be a ` +
        `\`z.object({...})\` — intersections and unions of objects are supported, but ` +
        `primitives, tuples, transforms, and other non-object leaves are not. Drop ` +
        `\`flatten: true\` to emit the original schema with its composition intact.`,
    );
  }
  const mergedShape: Record<string, z.ZodType> = {};
  for (const shape of collected.shapes) {
    Object.assign(mergedShape, shape);
  }
  if (collected.unionCrossed) {
    // Wrap each property in `.optional()` — no single property is guaranteed
    // across the original union variants, so the merged spec must allow any
    // subset. Runtime validation against the original schema still enforces
    // the precise variant shape.
    for (const key of Object.keys(mergedShape)) {
      const value = mergedShape[key];
      if (value !== undefined) {
        mergedShape[key] = value.optional();
      }
    }
  }
  const merged = z.object(mergedShape);
  // Register the root if it has a `.meta({ id })` so the schema's natural
  // (non-flattened) emission lands in `components.schemas[id]` via the
  // exposure-by-registration rule in `applyZodNest`. The inline operation
  // body remains the flat merged form for Swagger UI compatibility — the
  // catalog gets the structural composition (`allOf` / `oneOf`). No-op
  // when the schema is anonymous.
  registerSchema(schema, registry);
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
