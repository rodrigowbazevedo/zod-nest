import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

import { ZodValidationException, ZodValidationPipe } from '../../src';

const meta = (): ArgumentMetadata => ({ type: 'body', data: undefined, metatype: undefined });

describe('ZodValidationPipe — async refinements', () => {
  it('supports schemas with async .refine and resolves a valid value', async () => {
    const schema = z.object({
      email: z.string().refine(async (v) => v.endsWith('@example.com'), 'must be @example.com'),
    });
    const pipe = new ZodValidationPipe(schema);

    expect(await pipe.transform({ email: 'me@example.com' }, meta())).toEqual({
      email: 'me@example.com',
    });
  });

  it('rejects with ZodValidationException when async refinement fails', async () => {
    const schema = z.object({
      email: z.string().refine(async (v) => v.endsWith('@example.com'), 'must be @example.com'),
    });
    const pipe = new ZodValidationPipe(schema);

    await expect(pipe.transform({ email: 'me@elsewhere.com' }, meta())).rejects.toBeInstanceOf(
      ZodValidationException,
    );
  });
});
