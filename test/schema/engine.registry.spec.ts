import { z } from 'zod';

import { createRegistry, toOpenApi } from '../../src';

describe('toOpenApi — registry', () => {
  it('detects duplicate ids and emits invalid-marker schema', () => {
    const registry = createRegistry();
    const a = z.object({ a: z.string() });
    const b = z.object({ b: z.number() });
    registry.register(a, 'Registry_Duplicate');
    registry.register(b, 'Registry_Duplicate');

    expect(registry.hasCollision('Registry_Duplicate')).toBe(true);

    // Reference one of the colliding schemas as a sub-schema so Zod extracts it to refs.
    const Container = z.object({ value: b });
    const out = toOpenApi(Container, { io: 'output', registry });

    expect(out.refs.get('Registry_Duplicate')).toEqual({
      description: 'ERROR: duplicate zod-nest id <Registry_Duplicate>',
      'x-zod-nest-error': 'duplicate-id',
    });
  });

  it('does not flag a single registration as collision', () => {
    const registry = createRegistry();
    const a = z.object({ a: z.string() });
    registry.register(a, 'Registry_Single');
    expect(registry.hasCollision('Registry_Single')).toBe(false);
  });

  it('skips a registry collision that the emitted schema does not reference', () => {
    const registry = createRegistry();
    // A collision exists in the registry…
    registry.register(z.object({ a: z.string() }), 'Registry_UnrefCollision');
    registry.register(z.object({ b: z.number() }), 'Registry_UnrefCollision');
    expect(registry.hasCollision('Registry_UnrefCollision')).toBe(true);

    // …but the schema we emit doesn't reference it, so the collision id is not
    // in the result's refs and the decoration loop skips it (no error marker,
    // no throw).
    const Unrelated = z.object({ value: z.string() }).meta({ id: 'Registry_Unrelated' });
    const out = toOpenApi(Unrelated, { io: 'output', registry });

    expect(out.refs.has('Registry_UnrefCollision')).toBe(false);
    expect(out.schema).toBeDefined();
  });
});
