import { z } from 'zod';

import { createZodDto } from '../../src';

describe('createZodDto — .Output sibling', () => {
  it('always returns a distinct sibling class with io: "output"', () => {
    const schema = z.object({ x: z.string(), y: z.number() });
    class Output_Plain_Dto extends createZodDto(schema, { id: 'Output_Plain' }) {}

    const sibling = Output_Plain_Dto.Output;
    expect(sibling).not.toBe(Output_Plain_Dto);
    expect(sibling.io).toBe('output');
    expect(Output_Plain_Dto.io).toBe('input');
  });

  it('also works for schemas with transforms that diverge between io modes', () => {
    const schema = z.object({
      n: z
        .string()
        .transform((v) => Number(v))
        .pipe(z.number()),
    });
    class Output_Diverge_Dto extends createZodDto(schema, { id: 'Output_Diverge' }) {}

    expect(Output_Diverge_Dto.Output.io).toBe('output');
  });

  it('memoizes .Output across repeated reads', () => {
    const schema = z.object({ x: z.string() });
    class Output_Memo_Dto extends createZodDto(schema, { id: 'Output_Memo' }) {}

    expect(Output_Memo_Dto.Output).toBe(Output_Memo_Dto.Output);
  });

  it('.Output.Output === .Output (idempotent)', () => {
    const schema = z.object({ x: z.string() });
    class Output_Idem_Dto extends createZodDto(schema, { id: 'Output_Idem' }) {}

    const sibling = Output_Idem_Dto.Output;
    expect(sibling.Output).toBe(sibling);
  });

  it('sibling.id === parent.id (suffix logic lives in Phase 2e)', () => {
    const schema = z.object({ x: z.string() });
    class Output_SameId_Dto extends createZodDto(schema, { id: 'Output_SameId' }) {}

    expect(Output_SameId_Dto.Output.id).toBe(Output_SameId_Dto.id);
  });
});
