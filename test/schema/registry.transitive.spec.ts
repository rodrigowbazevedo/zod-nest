import { z } from 'zod';

import { createRegistry } from '../../src/schema/registry.js';

describe('ZodNestRegistry.register() — transitive closure', () => {
  it('registers a nested .meta({ id }) child of a registered object', () => {
    const Child = z.enum(['a', 'b']).meta({ id: 'Trans_Child1' });
    const Parent = z.object({ child: Child });

    const registry = createRegistry();
    registry.register(Parent, 'Trans_Parent1');

    expect(new Set(registry.ids())).toEqual(new Set(['Trans_Parent1', 'Trans_Child1']));
  });

  it('walks a 3-deep chain when only the outermost is explicitly registered', () => {
    const Leaf = z.string().meta({ id: 'Trans_Leaf' });
    const Mid = z.object({ leaf: Leaf }).meta({ id: 'Trans_Mid' });
    const Root = z.object({ mid: Mid });

    const registry = createRegistry();
    registry.register(Root, 'Trans_Root');

    expect(new Set(registry.ids())).toEqual(new Set(['Trans_Root', 'Trans_Mid', 'Trans_Leaf']));
  });

  it('walks through union / array / optional / lazy / intersection wrappers', () => {
    const NamedA = z.literal('a').meta({ id: 'Trans_WrapA' });
    const NamedB = z.literal('b').meta({ id: 'Trans_WrapB' });
    const NamedC = z.literal('c').meta({ id: 'Trans_WrapC' });
    const NamedD = z.literal('d').meta({ id: 'Trans_WrapD' });
    const NamedE = z.literal('e').meta({ id: 'Trans_WrapE' });

    const Composite = z.object({
      uni: z.union([NamedA, z.string()]),
      arr: z.array(NamedB),
      opt: NamedC.optional(),
      lazy: z.lazy(() => NamedD),
      inter: z.intersection(NamedE, z.object({ extra: z.number() })),
    });

    const registry = createRegistry();
    registry.register(Composite, 'Trans_WrapRoot');

    expect(new Set(registry.ids())).toEqual(
      new Set([
        'Trans_WrapRoot',
        'Trans_WrapA',
        'Trans_WrapB',
        'Trans_WrapC',
        'Trans_WrapD',
        'Trans_WrapE',
      ]),
    );
  });

  it('walks through tuple items + rest, record, map, set, and pipe', () => {
    const Item0 = z.literal('i0').meta({ id: 'Trans_TupItem0' });
    const Item1 = z.literal('i1').meta({ id: 'Trans_TupItem1' });
    const Rest = z.literal('rest').meta({ id: 'Trans_TupRest' });
    const RecVal = z.literal('rv').meta({ id: 'Trans_RecVal' });
    const MapVal = z.literal('mv').meta({ id: 'Trans_MapVal' });
    const SetVal = z.literal('sv').meta({ id: 'Trans_SetVal' });
    const PipeIn = z.string().meta({ id: 'Trans_PipeIn' });
    const PipeOut = z.literal('po').meta({ id: 'Trans_PipeOut' });

    const Composite = z.object({
      tup: z.tuple([Item0, Item1]).rest(Rest),
      rec: z.record(z.string(), RecVal),
      map: z.map(z.string(), MapVal),
      set: z.set(SetVal),
      pipe: z.pipe(PipeIn, PipeOut),
    });

    const registry = createRegistry();
    registry.register(Composite, 'Trans_CompositeRoot');

    expect(new Set(registry.ids())).toEqual(
      new Set([
        'Trans_CompositeRoot',
        'Trans_TupItem0',
        'Trans_TupItem1',
        'Trans_TupRest',
        'Trans_RecVal',
        'Trans_MapVal',
        'Trans_SetVal',
        'Trans_PipeIn',
        'Trans_PipeOut',
      ]),
    );
  });

  it('walks a tuple with no rest (the `def.rest === null` path)', () => {
    const Only = z.literal('only').meta({ id: 'Trans_TupNoRest_Item' });
    const Composite = z.object({ tup: z.tuple([Only]) });

    const registry = createRegistry();
    registry.register(Composite, 'Trans_TupNoRest_Root');

    expect(new Set(registry.ids())).toEqual(
      new Set(['Trans_TupNoRest_Root', 'Trans_TupNoRest_Item']),
    );
  });

  it('visits a shared child only once when reached from two parents in the same tree', () => {
    // `Shared` is referenced from BOTH siblings — gets pushed onto the
    // walker stack twice but must only contribute one entry to `seen`.
    const Shared = z.literal('s').meta({ id: 'Trans_Shared' });
    const Composite = z.object({ a: Shared, b: Shared });

    const registry = createRegistry();
    registry.register(Composite, 'Trans_SharedRoot');

    const collisions = registry.getCollisions();
    expect(collisions.has('Trans_Shared')).toBe(false);
    expect(new Set(registry.ids())).toEqual(new Set(['Trans_SharedRoot', 'Trans_Shared']));
  });

  it('does not infinite-loop on a self-referential z.lazy schema and still walks past the cycle', () => {
    const Leaf = z.string().meta({ id: 'Trans_RecLeaf' });
    interface Node {
      child?: Node;
      leaf: string;
    }
    const Node: z.ZodType<Node> = z.lazy(() => z.object({ child: Node.optional(), leaf: Leaf }));

    const registry = createRegistry();
    expect(() => registry.register(Node, 'Trans_RecRoot')).not.toThrow();
    expect(new Set(registry.ids())).toEqual(new Set(['Trans_RecRoot', 'Trans_RecLeaf']));
  });

  it('does NOT register a nested child that has no .meta({ id })', () => {
    const Anon = z.enum(['x', 'y']);
    const Parent = z.object({ child: Anon });

    const registry = createRegistry();
    registry.register(Parent, 'Trans_AnonParent');

    expect(registry.ids()).toEqual(['Trans_AnonParent']);
  });

  it('records a collision when two distinct nested schemas share the same .meta({ id })', () => {
    const ShareA = z.literal('a').meta({ id: 'Trans_Collide' });
    const ShareB = z.literal('b').meta({ id: 'Trans_Collide' });
    const Parent = z.object({ a: ShareA, b: ShareB });

    const registry = createRegistry();
    registry.register(Parent, 'Trans_CollideParent');

    expect(registry.hasCollision('Trans_Collide')).toBe(true);
    const collisions = registry.getCollisions();
    expect(collisions.get('Trans_Collide')?.size).toBe(2);
  });

  it('is idempotent: re-registering the same schema/id is a no-op', () => {
    const Child = z.enum(['p', 'q']).meta({ id: 'Trans_Idem_Child' });
    const Parent = z.object({ child: Child });

    const registry = createRegistry();
    registry.register(Parent, 'Trans_Idem_Parent');
    registry.register(Parent, 'Trans_Idem_Parent');

    expect(registry.hasCollision('Trans_Idem_Parent')).toBe(false);
    expect(registry.hasCollision('Trans_Idem_Child')).toBe(false);
  });
});
