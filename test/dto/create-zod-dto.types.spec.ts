import { expectTypeOf } from 'expect-type';
import { z } from 'zod';

import type { ZodDto } from '../../src';

import { createZodDto } from '../../src';

// Compile-only checks. The runtime body uses `expect(true).toBe(true)` so the
// suite stays valid for jest; the value is that the file fails to typecheck
// when the inferred types drift.

describe('createZodDto — TypeScript inference (compile-only)', () => {
  it('infers instance type as z.infer<TSchema>', () => {
    const schema = z.object({ id: z.string(), age: z.number() });
    class Types_User_Dto extends createZodDto(schema, { id: 'Types_User' }) {}

    type Instance = InstanceType<typeof Types_User_Dto>;
    const sample: Instance = { id: 'a', age: 1 };

    // @ts-expect-error - `age` is a number, not a string
    const wrong: Instance = { id: 'a', age: 'one' };

    // expect-type assertion — clearer failure than the type-annotated style
    // above when the inferred type drifts (e.g. createZodDto starts returning
    // `unknown` or losing the schema generic).
    expectTypeOf<Instance>().toEqualTypeOf<z.output<typeof schema>>();

    void Types_User_Dto;
    void sample;
    void wrong;
    expect(true).toBe(true);
  });

  it('parse return type is z.infer<TSchema>', () => {
    const schema = z.object({ id: z.string() });
    class Types_Parse_Dto extends createZodDto(schema, { id: 'Types_Parse' }) {}

    const parsed: { id: string } = Types_Parse_Dto.parse({ id: 'x' });
    void parsed;
    expect(true).toBe(true);
  });

  it('ZodDto<TSchema> is exported and shape-checks against a DTO class', () => {
    const schema = z.object({ id: z.string() });
    class Types_Shape_Dto extends createZodDto(schema, { id: 'Types_Shape' }) {}

    const asInterface: ZodDto<typeof schema> = Types_Shape_Dto;
    void asInterface;
    expect(true).toBe(true);
  });

  // The four cases below all touch the same TS2509 fault line: a class can
  // only extend a single object type, and Zod's `z.intersection(obj, union)`
  // / `z.discriminatedUnion` infer to `Obj & (A | B)` which TS distributes
  // to a union. The `UnionToIntersection` wrap on the constructor signature
  // collapses the union back to a single intersection for class-base usage;
  // `parse()` stays precise.
  it('intersection(obj, union(...)) — TS2509 regression', () => {
    const A = z.object({ kind: z.literal('a'), a: z.string() });
    const B = z.object({ kind: z.literal('b'), b: z.number() });
    const Obj = z.object({ id: z.string() });
    const schema = z.intersection(Obj, z.union([A, B]));
    class Types_IU_Dto extends createZodDto(schema, { id: 'Types_IU' }) {}

    expectTypeOf(Types_IU_Dto.parse).returns.toEqualTypeOf<z.output<typeof schema>>();
    void Types_IU_Dto;
    expect(true).toBe(true);
  });

  it('flat intersection of two objects compiles and infers the merged shape', () => {
    const schema = z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }));
    class Types_FI_Dto extends createZodDto(schema, { id: 'Types_FI' }) {}

    expectTypeOf<InstanceType<typeof Types_FI_Dto>>().toEqualTypeOf<{ a: string; b: number }>();
    void Types_FI_Dto;
    expect(true).toBe(true);
  });

  it('nested intersection (no union) compiles', () => {
    const schema = z.intersection(
      z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
      z.object({ c: z.boolean() }),
    );
    class Types_N_Dto extends createZodDto(schema, { id: 'Types_N' }) {}

    void Types_N_Dto;
    expect(true).toBe(true);
  });

  it('bare discriminated union — parse() stays precise even though instance type is lossy', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.string() }),
      z.object({ kind: z.literal('b'), b: z.number() }),
    ]);
    class Types_DU_Dto extends createZodDto(schema, { id: 'Types_DU' }) {}

    expectTypeOf(Types_DU_Dto.parse).returns.toEqualTypeOf<z.output<typeof schema>>();
    void Types_DU_Dto;
    expect(true).toBe(true);
  });
});
