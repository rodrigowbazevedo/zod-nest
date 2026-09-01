import { z } from 'zod';

import type { ToOpenApiResult } from '../../src/schema/engine.js';

import { createRegistry, toOpenApi } from '../../src';

const emit = (schema: z.ZodType): ToOpenApiResult =>
  toOpenApi(schema, { io: 'input', registry: createRegistry() });

describe('postProcess — named root lifting', () => {
  it('inlines a named root and leaves it out of refs', () => {
    const Named = z.object({ id: z.string() }).meta({ id: 'PP_Named' });

    const { schema, refs } = emit(Named);

    expect(schema.type).toBe('object');
    expect(schema.properties?.id).toEqual({ type: 'string' });
    expect(schema.$ref).toBeUndefined();
    expect(refs.has('PP_Named')).toBe(false);
  });

  it('inlines a named root while keeping its named child in refs', () => {
    const Child = z.object({ label: z.string() }).meta({ id: 'PP_Child' });
    const Parent = z.object({ child: Child }).meta({ id: 'PP_Parent' });

    const { schema, refs } = emit(Parent);

    expect(schema.properties?.child).toEqual({ $ref: '#/components/schemas/PP_Child' });
    expect(refs.has('PP_Parent')).toBe(false);
    expect(refs.get('PP_Child')?.properties?.label).toEqual({ type: 'string' });
  });

  it('preserves metadata carried on the lifted root', () => {
    const Annotated = z
      .object({ id: z.string() })
      .meta({ id: 'PP_Annotated', title: 'Title', description: 'Description' });

    const { schema } = emit(Annotated);

    expect(schema.title).toBe('Title');
    expect(schema.description).toBe('Description');
  });

  it('leaves an anonymous root untouched', () => {
    const { schema, refs } = emit(z.object({ id: z.string() }));

    expect(schema.type).toBe('object');
    expect(schema.$ref).toBeUndefined();
    expect(refs.size).toBe(0);
  });

  it('keeps a self-recursive named root as a $ref so the cycle resolves', () => {
    interface Tree {
      value: string;
      children: Tree[];
    }
    const Tree: z.ZodType<Tree> = z.lazy(() =>
      z.object({ value: z.string(), children: z.array(Tree) }).meta({ id: 'PP_Tree' }),
    );

    const { schema, refs } = emit(Tree);

    expect(schema).toEqual({ $ref: '#/components/schemas/PP_Tree' });
    expect(refs.get('PP_Tree')?.properties?.children).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/PP_Tree' },
    });
  });
});
