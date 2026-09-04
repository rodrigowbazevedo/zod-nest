import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ZodNestRegistry } from '../../src/schema/registry.js';

import { flattenObjectIntersection } from '../../src/decorators/internal/flatten-intersection.js';
import { toOpenApi } from '../../src/schema/engine.js';
import { createRegistry } from '../../src/schema/registry.js';

// The merged object is anonymous — the decorators hand it to `resolveSchemaRef`
// with `deferAnonInline`, so `applyZodNest` emits it. Emitting it here directly
// asserts the merge itself, at the same `io` the decorators use.
const emit = (schema: z.ZodType, registry: ZodNestRegistry): Record<string, unknown> => {
  const merged = flattenObjectIntersection(schema, registry, '@ZodBody');
  return toOpenApi(merged, { io: 'input', registry }).schema;
};

const propertyKeys = (body: Record<string, unknown>): string[] => {
  const properties = body.properties;
  if (properties === null || typeof properties !== 'object') {
    throw new Error('Merged body has no properties');
  }
  return Object.keys(properties).sort();
};

const requiredKeys = (body: Record<string, unknown>): string[] => {
  const required = body.required;
  return Array.isArray(required) ? required : [];
};

describe('flattenObjectIntersection', () => {
  it('merges an intersection of two named object schemas into one flat object', () => {
    const registry = createRegistry();
    const Left = z.object({ a: z.string(), b: z.number() }).meta({ id: 'ZB_Flat_Left' });
    const Right = z.object({ c: z.boolean() }).meta({ id: 'ZB_Flat_Right' });
    const schema = z.intersection(Left, Right).meta({ id: 'ZB_Flat_Root' });

    const body = emit(schema, registry);
    expect(body.$ref).toBeUndefined();
    expect(body.type).toBe('object');
    expect(propertyKeys(body)).toEqual(['a', 'b', 'c']);
    // Root id IS registered — the schema's natural (allOf) emission lands
    // in `components.schemas[id]` via applyZodNest's exposure rule
    // ("every registered id is exposed"). The operation body stays the
    // flat merged form for Swagger UI compatibility.
    expect(registry.ids()).toContain('ZB_Flat_Root');
  });

  it('flattens nested intersections', () => {
    const registry = createRegistry();
    const A = z.object({ a: z.string() });
    const B = z.object({ b: z.number() });
    const C = z.object({ c: z.boolean() });

    expect(propertyKeys(emit(z.intersection(z.intersection(A, B), C), registry))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('preserves per-property $ref for named child schemas', () => {
    const registry = createRegistry();
    const NamedChild = z.object({ v: z.string() }).meta({ id: 'ZB_Flat_NamedChild' });
    const schema = z.intersection(z.object({ child: NamedChild }), z.object({ other: z.string() }));

    const properties = emit(schema, registry).properties;
    expect(properties).toMatchObject({
      child: { $ref: '#/components/schemas/ZB_Flat_NamedChild' },
      other: { type: 'string' },
    });
    expect(registry.ids()).toContain('ZB_Flat_NamedChild');
  });

  it('resolves property collisions with last-arm-wins', () => {
    const registry = createRegistry();
    const schema = z.intersection(z.object({ dupe: z.string() }), z.object({ dupe: z.number() }));

    // Right arm wins: `dupe` ends up as a number.
    expect(emit(schema, registry).properties).toMatchObject({ dupe: { type: 'number' } });
  });

  it('merges intersection-of-unions into a flat object with all properties optional', () => {
    // The canonical user case (taxonomy translation): two unions of objects
    // intersected. Unflattened this emits `allOf: [oneOf, oneOf]`, which
    // Swagger UI's multipart form generator can't render. Flattened, the body
    // is a flat object whose fields cover every variant — runtime validation
    // against the original schema still enforces the precise variant shape.
    const registry = createRegistry();
    const schema = z.intersection(
      z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
      z.union([z.object({ c: z.string() }), z.object({ d: z.string() })]),
    );

    const body = emit(schema, registry);
    expect(body.$ref).toBeUndefined();
    expect(body.allOf).toBeUndefined();
    expect(body.oneOf).toBeUndefined();
    expect(body.type).toBe('object');
    expect(propertyKeys(body)).toEqual(['a', 'b', 'c', 'd']);
    // Union-crossed → no property is required at the spec level.
    expect(requiredKeys(body)).toEqual([]);
  });

  it('flattens a bare union of objects with all properties optional', () => {
    const registry = createRegistry();
    const schema = z.union([
      z.object({ alpha: z.string(), shared: z.string() }),
      z.object({ beta: z.number(), shared: z.string() }),
    ]);

    const body = emit(schema, registry);
    expect(body.type).toBe('object');
    expect(propertyKeys(body)).toEqual(['alpha', 'beta', 'shared']);
    expect(requiredKeys(body)).toEqual([]);
  });

  it('flattens a discriminated union of objects', () => {
    const registry = createRegistry();
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), value: z.string() }),
      z.object({ kind: z.literal('b'), count: z.number() }),
    ]);

    const body = emit(schema, registry);
    expect(body.type).toBe('object');
    expect(propertyKeys(body)).toEqual(['count', 'kind', 'value']);
  });

  it('marks every property optional when only one arm of the intersection is union-shaped', () => {
    // Mixed shape: pure object on the left, union of objects on the right.
    // Exercises the `unionCrossed: left.unionCrossed || right.unionCrossed`
    // branch where left=false / right=true.
    const registry = createRegistry();
    const schema = z.intersection(
      z.object({ alwaysHere: z.string() }),
      z.union([z.object({ v1: z.string() }), z.object({ v2: z.number() })]),
    );

    const body = emit(schema, registry);
    expect(propertyKeys(body)).toEqual(['alwaysHere', 'v1', 'v2']);
    // unionCrossed → all properties optional, including `alwaysHere` from the
    // non-union arm. Documented trade-off.
    expect(requiredKeys(body)).toEqual([]);
  });

  it('is an identity merge for a bare z.object', () => {
    const registry = createRegistry();
    const body = emit(z.object({ q: z.string(), n: z.number() }), registry);

    expect(body.type).toBe('object');
    expect(propertyKeys(body)).toEqual(['n', 'q']);
    expect(requiredKeys(body).sort()).toEqual(['n', 'q']);
  });
});
