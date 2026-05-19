import { z } from 'zod';

import type { SchemaObject } from '../../../src/schema/openapi.types.js';

import { extend } from '../../../src/schema/composition.js';
import { toOpenApi } from '../../../src/schema/engine.js';
import { createRegistry, defaultRegistry } from '../../../src/schema/registry.js';

const emit = (schema: z.ZodType): SchemaObject => {
  const registry = createRegistry();
  return toOpenApi(schema, { io: 'input', registry }).schema;
};

describe('composition emission — extend with registered parent', () => {
  it('produces allOf: [$ref, delta] for a single-level extend', () => {
    const Base = z.object({ id: z.string(), name: z.string() }).meta({ id: 'Comp_Base_Single' });
    const Child = extend(Base, (s) =>
      s.extend({ role: z.string() }).meta({ id: 'Comp_Child_Single' }),
    );

    const body = emit(Child) as {
      allOf?: ({ $ref?: string } | Record<string, unknown>)[];
      unevaluatedProperties?: boolean;
    };

    expect(body.allOf).toBeDefined();
    expect(body.allOf?.length).toBe(2);
    expect((body.allOf?.[0] as { $ref?: string }).$ref).toBe(
      '#/components/schemas/Comp_Base_Single',
    );
    expect(body.allOf?.[1]).toMatchObject({
      type: 'object',
      properties: { role: { type: 'string' } },
      required: ['role'],
    });
    expect(body.unevaluatedProperties).toBe(false);
  });

  it('delta omits additionalProperties', () => {
    const Base = z.object({ id: z.string() }).meta({ id: 'Comp_Base_NoAddProps' });
    const Child = extend(Base, (s) =>
      s.extend({ role: z.string() }).meta({ id: 'Comp_Child_NoAddProps' }),
    );

    const body = emit(Child) as {
      allOf?: { additionalProperties?: unknown; properties?: Record<string, unknown> }[];
    };

    const delta = body.allOf?.[1] as { additionalProperties?: unknown };
    expect(delta).toBeDefined();
    expect(delta.additionalProperties).toBeUndefined();
  });

  it('outer carries unevaluatedProperties: false (not additionalProperties)', () => {
    const Base = z.object({ id: z.string() }).meta({ id: 'Comp_Base_UnevalProps' });
    const Child = extend(Base, (s) =>
      s.extend({ role: z.string() }).meta({ id: 'Comp_Child_UnevalProps' }),
    );

    const body = emit(Child) as Record<string, unknown>;

    expect(body.unevaluatedProperties).toBe(false);
    expect(body.additionalProperties).toBeUndefined();
    expect(body.type).toBeUndefined();
    expect(body.properties).toBeUndefined();
    expect(body.required).toBeUndefined();
  });

  it('preserves user meta (title, description) on the outer node', () => {
    // Zod consumes `id` for $defs/registry extraction at emit time, so it
    // doesn't survive on the inline body — but `title` and `description`
    // (and other arbitrary meta) DO survive when the composition override
    // rebuilds the body as `allOf`.
    const Base = z.object({ id: z.string() }).meta({ id: 'Comp_Base_Meta' });
    const Child = extend(Base, (s) =>
      s.extend({ role: z.string() }).meta({
        id: 'Comp_Child_Meta',
        title: 'Child Title',
        description: 'A child schema with annotations',
      }),
    );

    const body = emit(Child) as Record<string, unknown>;
    expect(body.title).toBe('Child Title');
    expect(body.description).toBe('A child schema with annotations');
    expect(body.allOf).toBeDefined();
  });
});

describe('composition emission — chained extends', () => {
  // Each composed schema, when emitted directly, produces a 2-element allOf
  // pointing at its IMMEDIATE parent. The chain forms naturally as each
  // intermediate schema's body $refs the level above it.
  const Base = z.object({ id: z.string() }).meta({ id: 'Comp_Chain_Base' });
  const Child = extend(Base, (s) =>
    s.extend({ role: z.string() }).meta({ id: 'Comp_Chain_Child' }),
  );
  const GrandChild = extend(Child, (s) =>
    s.extend({ age: z.number() }).meta({ id: 'Comp_Chain_GrandChild' }),
  );

  it('GrandChild emits allOf[$ref: Child, { age }]', () => {
    const body = emit(GrandChild) as {
      allOf?: ({ $ref?: string } | Record<string, unknown>)[];
    };
    expect(body.allOf?.length).toBe(2);
    expect((body.allOf?.[0] as { $ref?: string }).$ref).toBe(
      '#/components/schemas/Comp_Chain_Child',
    );
    expect(body.allOf?.[1]).toMatchObject({
      properties: { age: { type: 'number' } },
      required: ['age'],
    });
  });

  it('Child emits allOf[$ref: Base, { role }]', () => {
    const body = emit(Child) as {
      allOf?: ({ $ref?: string } | Record<string, unknown>)[];
    };
    expect(body.allOf?.length).toBe(2);
    expect((body.allOf?.[0] as { $ref?: string }).$ref).toBe(
      '#/components/schemas/Comp_Chain_Base',
    );
    expect(body.allOf?.[1]).toMatchObject({
      properties: { role: { type: 'string' } },
      required: ['role'],
    });
  });

  it('Base (chain root) emits flat — no allOf', () => {
    const body = emit(Base) as Record<string, unknown>;
    expect(body.allOf).toBeUndefined();
    expect(body.type).toBe('object');
  });
});

describe('composition emission — fallback cases', () => {
  it('falls back to flat emission when the parent has no .meta({ id })', () => {
    const AnonBase = z.object({ id: z.string() }); // NO .meta({ id })
    const Child = extend(AnonBase, (s) =>
      s.extend({ role: z.string() }).meta({ id: 'Comp_AnonParent_Child' }),
    );

    const body = emit(Child) as Record<string, unknown>;

    // No allOf — falls through to Zod's flat object emission.
    expect(body.allOf).toBeUndefined();
    expect(body.type).toBe('object');
    expect(body.properties).toMatchObject({
      id: { type: 'string' },
      role: { type: 'string' },
    });
  });

  it('plain z.object() with no lineage emits flat (no composition machinery fires)', () => {
    const Plain = z.object({ x: z.string() }).meta({ id: 'Comp_Plain' });
    const body = emit(Plain) as Record<string, unknown>;

    expect(body.allOf).toBeUndefined();
    expect(body.type).toBe('object');
    expect(body.properties).toMatchObject({ x: { type: 'string' } });
  });
});

describe('composition emission — interplay with primitiveOverride', () => {
  it('bigint inside a composed schema still triggers primitive override (integer type)', () => {
    const Base = z.object({ id: z.string() }).meta({ id: 'Comp_Bigint_Base' });
    const Child = extend(Base, (s) =>
      s.extend({ counter: z.bigint() }).meta({ id: 'Comp_Bigint_Child' }),
    );

    const body = emit(Child) as { allOf?: { properties?: Record<string, unknown> }[] };
    const delta = body.allOf?.[1];
    expect((delta?.properties?.counter as { type?: string })?.type).toBe('integer');
  });
});

describe('composition emission — extend() auto-registers named parent + result', () => {
  // Regression for the dangling-ref bug: Zod's `.extend()` flattens, so the
  // parent isn't a transitive descendant of the result. `extend()` itself
  // now eager-registers both (in defaultRegistry), and the composition
  // override re-registers in the active registry as a backstop — together
  // these guarantee the parent's body is emitted into `components.schemas`.

  it('extend() eager-registers the named parent and result in defaultRegistry', () => {
    const Parent = z.object({ x: z.string() }).meta({ id: 'Comp_Auto_Eager_Parent' });
    const Child = extend(Parent, (s) =>
      s.extend({ y: z.string() }).meta({ id: 'Comp_Auto_Eager_Child' }),
    );
    void Child;

    const ids = new Set(defaultRegistry.ids());
    expect(ids.has('Comp_Auto_Eager_Parent')).toBe(true);
    expect(ids.has('Comp_Auto_Eager_Child')).toBe(true);
  });

  it('override-time backstop registers the parent in a custom registry at emit time', () => {
    const Parent = z.object({ id: z.string() }).meta({ id: 'Comp_Auto_Backstop_Parent' });
    const Child = extend(Parent, (s) =>
      s.extend({ role: z.string() }).meta({ id: 'Comp_Auto_Backstop_Child' }),
    );

    // Fresh, isolated registry. extend() wrote to defaultRegistry above, so
    // a positive result here proves the override-time call into this
    // registry actually fired.
    const registry = createRegistry();
    toOpenApi(Child, { io: 'input', registry });

    expect(new Set(registry.ids())).toEqual(new Set(['Comp_Auto_Backstop_Parent']));
  });
});

describe('composition emission — all-optional shapes', () => {
  // Zod omits the `required` array entirely when every property is optional.
  // The override's `jsonSchema.required ?? []` fallback must handle that
  // without crashing or emitting a stray `required` on the delta.
  it('handles a child where every field (parent + delta) is optional', () => {
    const Base = z.object({ id: z.string().optional() }).meta({ id: 'Comp_AllOpt_Base' });
    const Child = extend(Base, (s) =>
      s.extend({ role: z.string().optional() }).meta({ id: 'Comp_AllOpt_Child' }),
    );

    const body = emit(Child) as {
      allOf?: ({ $ref?: string } | { properties?: Record<string, unknown>; required?: unknown })[];
    };
    expect((body.allOf?.[0] as { $ref?: string }).$ref).toBe(
      '#/components/schemas/Comp_AllOpt_Base',
    );
    const delta = body.allOf?.[1] as {
      properties?: Record<string, unknown>;
      required?: unknown;
    };
    expect(delta.properties).toMatchObject({ role: { type: 'string' } });
    // No `required` array on the delta — every key in it is optional.
    expect(delta.required).toBeUndefined();
  });
});
