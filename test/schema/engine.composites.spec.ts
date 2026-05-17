import { z } from 'zod';

import { createRegistry, toOpenApi } from '../../src';

describe('toOpenApi — composites', () => {
  const registry = createRegistry();
  const opts = { io: 'output' as const, registry };

  it('object with required + optional properties', () => {
    const schema = z.object({ a: z.string(), b: z.number().optional() });
    expect(toOpenApi(schema, opts).schema).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
      additionalProperties: false,
    });
  });

  it('array', () => {
    expect(toOpenApi(z.array(z.string()), opts).schema).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('tuple emits prefixItems (draft-2020-12)', () => {
    const out = toOpenApi(z.tuple([z.string(), z.number()]), opts).schema;
    expect(out.type).toBe('array');
    expect(out.prefixItems).toEqual([{ type: 'string' }, { type: 'number' }]);
  });

  it('union → anyOf', () => {
    const schema = z.union([z.string(), z.number()]);
    expect(toOpenApi(schema, opts).schema).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('discriminatedUnion → oneOf', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.string() }),
      z.object({ kind: z.literal('b'), b: z.number() }),
    ]);
    const out = toOpenApi(schema, opts).schema;
    expect(out.oneOf).toBeDefined();
    expect(Array.isArray(out.oneOf)).toBe(true);
    expect(out.oneOf?.length).toBe(2);
  });

  it('intersection → allOf', () => {
    const schema = z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }));
    const out = toOpenApi(schema, opts).schema;
    expect(out.allOf).toBeDefined();
    expect(Array.isArray(out.allOf)).toBe(true);
    expect(out.allOf?.length).toBe(2);
  });

  it('record → additionalProperties', () => {
    const schema = z.record(z.string(), z.number());
    const out = toOpenApi(schema, opts).schema;
    expect(out.type).toBe('object');
    expect(out.propertyNames).toEqual({ type: 'string' });
    expect(out.additionalProperties).toEqual({ type: 'number' });
  });

  it('strict object does not allow additional properties', () => {
    const schema = z.strictObject({ a: z.string() });
    const out = toOpenApi(schema, opts).schema;
    expect(out.additionalProperties).toBe(false);
  });
});
