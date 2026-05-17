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

    // Negative: assigning a wrong-typed instance should be a TS error.
    // @ts-expect-error - `age` is a number, not a string
    const wrong: Instance = { id: 'a', age: 'one' };

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
});
