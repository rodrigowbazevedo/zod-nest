import { z } from 'zod';

import { createZodDto, ZOD_DTO_SYMBOL } from '../../src';

describe('createZodDto — runtime symbol marker', () => {
  it('exposes ZOD_DTO_SYMBOL as a static-truthy marker on DTO classes', () => {
    const schema = z.object({ x: z.string() });
    class Sym_Dto extends createZodDto(schema, { id: 'Sym_Marker' }) {}

    expect((Sym_Dto as unknown as Record<symbol, unknown>)[ZOD_DTO_SYMBOL]).toBe(true);
  });

  it('Symbol.for("zod-nest.dto") resolves to the same registered symbol', () => {
    expect(ZOD_DTO_SYMBOL).toBe(Symbol.for('zod-nest.dto'));
  });

  it('output sibling carries the same marker', () => {
    const schema = z.object({
      n: z
        .string()
        .transform((v) => Number(v))
        .pipe(z.number()),
    });
    class Sym_Out_Dto extends createZodDto(schema, { id: 'Sym_Out' }) {}

    const sibling = Sym_Out_Dto.Output;
    expect((sibling as unknown as Record<symbol, unknown>)[ZOD_DTO_SYMBOL]).toBe(true);
  });
});
