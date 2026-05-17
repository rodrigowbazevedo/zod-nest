import { z } from 'zod';

import { extend } from '../../../src/schema/composition.js';
import { toOpenApi } from '../../../src/schema/engine.js';
import { createRegistry } from '../../../src/schema/registry.js';

interface ParentBody {
  properties?: Record<string, unknown>;
  required?: readonly string[];
}

interface ChildAllOfBody {
  allOf: [{ $ref: string }, ParentBody];
  unevaluatedProperties: boolean;
}

const emit = (schema: z.ZodType): unknown =>
  toOpenApi(schema, { io: 'input', registry: createRegistry() }).schema;

describe('composition roundtrip — composed schema describes the same shape as the flat Zod equivalent', () => {
  it('child allOf union (parent + delta) covers the same properties Zod parses', () => {
    const Base = z.object({ id: z.string(), name: z.string() }).meta({ id: 'RT_Base' });
    const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'RT_Child' }));

    // The Child schema (per Zod's runtime) accepts a payload with all three keys.
    const payload = { id: 'u1', name: 'alice', role: 'admin' };
    expect(Child.parse(payload)).toEqual(payload);

    // The JSON Schema for the parent flat shape and the child's delta together
    // describe the same property set.
    const parentEmit = emit(Base) as ParentBody;
    const childEmit = emit(Child) as ChildAllOfBody;
    const delta = childEmit.allOf[1];

    const combinedProps = new Set([
      ...Object.keys(parentEmit.properties ?? {}),
      ...Object.keys(delta.properties ?? {}),
    ]);
    expect(combinedProps).toEqual(new Set(['id', 'name', 'role']));

    // Required keys: union of parent required + delta required.
    const combinedRequired = new Set([...(parentEmit.required ?? []), ...(delta.required ?? [])]);
    expect(combinedRequired).toEqual(new Set(['id', 'name', 'role']));
  });

  it('delta only contains keys not in the parent (no duplication)', () => {
    const Base = z.object({ id: z.string(), name: z.string() }).meta({ id: 'RT_Base_NoDup' });
    const Child = extend(Base, (s) =>
      s.extend({ role: z.string() }).meta({ id: 'RT_Child_NoDup' }),
    );

    const childEmit = emit(Child) as ChildAllOfBody;
    const delta = childEmit.allOf[1];

    const parentProps = ['id', 'name'];
    const deltaPropKeys = Object.keys(delta.properties ?? {});
    for (const key of deltaPropKeys) {
      expect(parentProps).not.toContain(key);
    }
    expect(deltaPropKeys).toEqual(['role']);
  });

  it('optional delta property is not added to delta.required', () => {
    const Base = z.object({ id: z.string() }).meta({ id: 'RT_Base_Optional' });
    const Child = extend(Base, (s) =>
      s.extend({ nickname: z.string().optional() }).meta({ id: 'RT_Child_Optional' }),
    );

    // Zod accepts the payload with or without `nickname`.
    expect(Child.parse({ id: 'u1' })).toEqual({ id: 'u1' });
    expect(Child.parse({ id: 'u1', nickname: 'al' })).toEqual({ id: 'u1', nickname: 'al' });

    const childEmit = emit(Child) as ChildAllOfBody;
    const delta = childEmit.allOf[1];
    expect(delta.properties).toMatchObject({ nickname: { type: 'string' } });
    expect(delta.required ?? []).not.toContain('nickname');
  });

  it('chained extend preserves the cumulative shape across the chain', () => {
    const Base = z.object({ id: z.string() }).meta({ id: 'RT_Chain_Base' });
    const Child = extend(Base, (s) =>
      s.extend({ role: z.string() }).meta({ id: 'RT_Chain_Child' }),
    );
    const GrandChild = extend(Child, (s) =>
      s.extend({ age: z.number() }).meta({ id: 'RT_Chain_GrandChild' }),
    );

    // Zod parses all three layers' fields.
    expect(GrandChild.parse({ id: 'u1', role: 'admin', age: 33 })).toEqual({
      id: 'u1',
      role: 'admin',
      age: 33,
    });

    // Each layer's delta contains only its OWN incremental keys.
    const childEmit = emit(Child) as ChildAllOfBody;
    expect(Object.keys(childEmit.allOf[1].properties ?? {})).toEqual(['role']);

    const grandEmit = emit(GrandChild) as ChildAllOfBody;
    expect(Object.keys(grandEmit.allOf[1].properties ?? {})).toEqual(['age']);
  });
});
