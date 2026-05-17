import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

import { createZodDto, ZodValidationPipe } from '../../src';

const meta = (): ArgumentMetadata => ({ type: 'body', data: undefined, metatype: undefined });

describe('ZodValidationPipe — explicit constructor arg', () => {
  it('accepts a ZodDto class directly', async () => {
    const schema = z.object({ x: z.string() });
    class Exp_Dto extends createZodDto(schema, { id: 'Exp_Dto' }) {}
    const pipe = new ZodValidationPipe(Exp_Dto);

    expect(await pipe.transform({ x: 'a' }, meta())).toEqual({ x: 'a' });
  });

  it('accepts a raw Zod schema directly', async () => {
    const schema = z.object({ q: z.string() });
    const pipe = new ZodValidationPipe(schema);

    expect(await pipe.transform({ q: 'hi' }, meta())).toEqual({ q: 'hi' });
  });

  it('accepts an options object with `schema` (Zod schema)', async () => {
    const schema = z.object({ n: z.number() });
    const pipe = new ZodValidationPipe({ schema });

    expect(await pipe.transform({ n: 1 }, meta())).toEqual({ n: 1 });
  });

  it('accepts an options object with `schema` (DTO class)', async () => {
    const schema = z.object({ x: z.string() });
    class Exp_Opt_Dto extends createZodDto(schema, { id: 'Exp_Opt' }) {}
    const pipe = new ZodValidationPipe({ schema: Exp_Opt_Dto });

    expect(await pipe.transform({ x: 'a' }, meta())).toEqual({ x: 'a' });
  });

  it('an explicit schema wins over the handler arg metatype', async () => {
    const explicit = z.object({ x: z.string() });
    const otherSchema = z.object({ x: z.number() });
    class Exp_Other_Dto extends createZodDto(otherSchema, { id: 'Exp_Other' }) {}

    const pipe = new ZodValidationPipe(explicit);
    // Even though metatype says number, the explicit schema (string) is used.
    expect(
      await pipe.transform({ x: 'use-explicit' }, { type: 'body', metatype: Exp_Other_Dto }),
    ).toEqual({ x: 'use-explicit' });
  });

  it('passes through when options.schema is undefined and no metatype DTO is found', async () => {
    const pipe = new ZodValidationPipe({});
    const value = { anything: 1 };
    expect(await pipe.transform(value, meta())).toBe(value);
  });

  it('falls back to pass-through when arg is a primitive (defensive guard)', async () => {
    // Type assertions used to deliberately violate the public signature —
    // exercises the runtime defensive guard for misuse from JS callers.
    const pipeFromString = new ZodValidationPipe('whoops' as unknown as undefined);
    const pipeFromNumber = new ZodValidationPipe(42 as unknown as undefined);
    const pipeFromNull = new ZodValidationPipe(null as unknown as undefined);

    const value = { anything: 1 };
    expect(await pipeFromString.transform(value, meta())).toBe(value);
    expect(await pipeFromNumber.transform(value, meta())).toBe(value);
    expect(await pipeFromNull.transform(value, meta())).toBe(value);
  });
});
