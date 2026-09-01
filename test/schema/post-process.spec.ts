import { z } from 'zod';

import type { ToOpenApiResult } from '../../src/schema/engine.js';
import type { SchemaObject } from '../../src/schema/openapi.types.js';

import { createRegistry, toOpenApi, ZodNestError } from '../../src';
import { postProcess } from '../../src/schema/post-process.js';

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

describe("postProcess — '#' resolves to the document root", () => {
  it('points a mutual-recursion ref at the root, not at the def holding it', () => {
    const Node = z
      .object({
        label: z.string(),
        get kids() {
          return z.array(Leaf);
        },
      })
      .meta({ id: 'PP_Node' });
    const Leaf = z
      .object({
        get owner() {
          return Node.optional();
        },
      })
      .meta({ id: 'PP_Leaf' });

    const { schema, refs } = emit(Node);

    expect(schema).toEqual({ $ref: '#/components/schemas/PP_Node' });
    expect(refs.get('PP_Leaf')?.properties?.owner).toEqual({
      $ref: '#/components/schemas/PP_Node',
    });
    expect(refs.get('PP_Node')?.properties?.kids).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/PP_Leaf' },
    });
  });

  it('leaves every emitted ref resolvable within refs', () => {
    const Node = z
      .object({
        label: z.string(),
        get kids() {
          return z.array(Leaf);
        },
      })
      .meta({ id: 'PP_ResolveNode' });
    const Leaf = z
      .object({
        get owner() {
          return Node.optional();
        },
      })
      .meta({ id: 'PP_ResolveLeaf' });

    const { schema, refs } = emit(Node);

    const unresolved: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }
      if (node === null || typeof node !== 'object') {
        return;
      }
      const obj = node as Record<string, unknown>;
      const ref = obj.$ref;
      if (typeof ref === 'string' && !refs.has(ref.replace('#/components/schemas/', ''))) {
        unresolved.push(ref);
      }
      for (const value of Object.values(obj)) {
        walk(value);
      }
    };
    walk(schema);
    for (const body of refs.values()) {
      walk(body);
    }

    expect(unresolved).toEqual([]);
  });

  it('throws when a referenced root has no id to resolve against', () => {
    const Root = z.object({
      get kids() {
        return z.array(Kid);
      },
    });
    const Kid = z
      .object({
        get owner() {
          return Root.optional();
        },
      })
      .meta({ id: 'PP_ThrowKid' });

    expect(() => emit(Root)).toThrow(ZodNestError);
    expect(() => emit(Root)).toThrow(/Add `\.meta\(\{ id/);
  });

  it('leaves the reference untouched instead of throwing when strict is off', () => {
    const Root = z.object({
      get kids() {
        return z.array(Kid);
      },
    });
    const Kid = z
      .object({
        get owner() {
          return Root.optional();
        },
      })
      .meta({ id: 'PP_LooseKid' });

    const { refs } = toOpenApi(Root, {
      io: 'input',
      registry: createRegistry(),
      strict: false,
    });

    expect(refs.get('PP_LooseKid')?.properties?.owner).toEqual({ $ref: '#' });
  });
});

describe('postProcess — inlined root that a def references', () => {
  // Zod 4.4 emits a named root inline and spells the cycle back to it as '#'.
  // Built by hand so the branch is covered whichever zod version is installed.
  const raw = {
    type: 'object',
    properties: {
      kids: { type: 'array', items: { $ref: '#/$defs/PP_RawLeaf' } },
    },
    $defs: {
      PP_RawLeaf: { type: 'object', properties: { owner: { $ref: '#' } } },
    },
  } satisfies SchemaObject;

  it('publishes the root under its id and returns a $ref', () => {
    const { schema, refs } = postProcess(raw, { rootId: 'PP_RawNode' });

    expect(schema).toEqual({ $ref: '#/components/schemas/PP_RawNode' });
    expect(refs.get('PP_RawNode')?.properties?.kids).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/PP_RawLeaf' },
    });
    expect(refs.get('PP_RawLeaf')?.properties?.owner).toEqual({
      $ref: '#/components/schemas/PP_RawNode',
    });
  });
});
