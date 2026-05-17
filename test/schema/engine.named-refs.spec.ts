import { z } from 'zod';

import { createRegistry, toOpenApi } from '../../src';

describe('toOpenApi — named refs via .meta({ id })', () => {
  it('lifts .meta({ id }) sub-schema to refs and rewrites $ref', () => {
    const Address = z
      .object({ city: z.string() })
      .meta({ id: 'NamedRefs_Address', title: 'Address' });
    const User = z.object({ name: z.string(), address: Address });

    const registry = createRegistry();
    const out = toOpenApi(User, { io: 'output', registry });

    expect(out.schema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        address: { $ref: '#/components/schemas/NamedRefs_Address' },
      },
      required: ['name', 'address'],
      additionalProperties: false,
    });

    expect(out.refs.has('NamedRefs_Address')).toBe(true);
    const addressBody = out.refs.get('NamedRefs_Address');
    expect(addressBody?.type).toBe('object');
    expect(addressBody?.title).toBe('Address');
    // Zod 4.4+ strips `id` from $defs entry bodies
    expect(addressBody?.id).toBeUndefined();
  });

  it('returned schema has no $defs and no #/$defs/ refs', () => {
    const Inner = z.object({ x: z.string() }).meta({ id: 'NamedRefs_Inner2' });
    const Outer = z.object({ inner: Inner, again: Inner });

    const registry = createRegistry();
    const out = toOpenApi(Outer, { io: 'output', registry });

    const text = JSON.stringify({ schema: out.schema, refs: Object.fromEntries(out.refs) });
    expect(text).not.toContain('#/$defs/');
    expect(out.schema.$defs).toBeUndefined();
  });

  it('refs body has no $schema', () => {
    const A = z.object({ a: z.string() }).meta({ id: 'NamedRefs_A_NoSchema' });
    const registry = createRegistry();
    const out = toOpenApi(z.object({ a: A }), { io: 'output', registry });
    expect(out.refs.get('NamedRefs_A_NoSchema')?.$schema).toBeUndefined();
  });
});
