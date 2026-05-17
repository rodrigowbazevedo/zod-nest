import { z } from 'zod';

import { createRegistry, toOpenApi } from '../../src';

describe('toOpenApi — recursion', () => {
  it('self-recursion via z.lazy + .meta({ id })', () => {
    interface Tree {
      value: string;
      children: Tree[];
    }
    const Tree: z.ZodType<Tree> = z.lazy(() =>
      z
        .object({ value: z.string(), children: z.array(Tree) })
        .meta({ id: 'Recursion_Tree', title: 'Tree' }),
    );

    const registry = createRegistry();
    const out = toOpenApi(Tree, { io: 'output', registry });

    // Top schema is the recursive ref body itself (Zod hoists named recursive schemas)
    const body = out.refs.get('Recursion_Tree');
    expect(body).toBeDefined();
    expect(body?.type).toBe('object');
    expect(body?.properties?.children).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Recursion_Tree' },
    });
  });
});
