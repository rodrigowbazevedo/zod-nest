import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

import { ZodValidationPipe } from '../../src';

const meta: ArgumentMetadata = { type: 'body', data: undefined, metatype: undefined };

describe('ZodValidationPipe — input-side parsing through transforms', () => {
  it('returns the transformed (output-side) value from a string→number pipe', async () => {
    const schema = z
      .string()
      .transform((v) => Number(v))
      .pipe(z.number());

    const pipe = new ZodValidationPipe(schema);
    const result = await pipe.transform('42', meta);
    expect(result).toBe(42);
  });

  it('rejects an input that fails the input-side type guard (number provided to a string-input schema)', async () => {
    const schema = z
      .string()
      .transform((v) => Number(v))
      .pipe(z.number());

    const pipe = new ZodValidationPipe(schema);
    await expect(pipe.transform(42, meta)).rejects.toBeDefined();
  });
});
