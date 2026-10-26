import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

import { ZodValidationException, ZodValidationPipe } from '../../src';
import { normalizeZodNestOptions } from '../../src/module/options.js';
import { isCompiled, loadZodCompile } from '../schema/zod-compile.js';

const hasZodCompile = await loadZodCompile();

const meta = (): ArgumentMetadata => ({ type: 'body', data: undefined, metatype: undefined });

describe.skipIf(!hasZodCompile)('ZodValidationPipe — zod/compile', () => {
  it("runs the compiled fast path under the default 'auto' mode", async () => {
    const schema = z.object({ id: z.string() });
    const pipe = new ZodValidationPipe(schema);

    expect(await pipe.transform({ id: 'a' }, meta())).toEqual({ id: 'a' });
    expect(isCompiled(schema)).toBe(true);
  });

  it("never compiles under parseMode 'async'", async () => {
    const schema = z.object({ id: z.string() });
    const pipe = new ZodValidationPipe(schema, normalizeZodNestOptions({ parseMode: 'async' }));

    await pipe.transform({ id: 'a' }, meta());

    expect(isCompiled(schema)).toBe(false);
  });

  it('reports the same issues on invalid input as the runtime parser', async () => {
    const schema = z.object({ id: z.string() });
    const pipe = new ZodValidationPipe(schema);
    const input = { id: 1 };
    const expected = await z.object({ id: z.string() }).safeParseAsync(input);

    const rejection: unknown = await pipe.transform(input, meta()).catch((err: unknown) => err);

    expect(rejection).toBeInstanceOf(ZodValidationException);
    expect(rejection instanceof ZodValidationException && rejection.zodError.issues).toEqual(
      expected.error?.issues,
    );
  });

  it('still validates a schema with an async .refine()', async () => {
    const schema = z.object({
      email: z.string().refine(async (v) => v.endsWith('@example.com'), 'must be @example.com'),
    });
    const pipe = new ZodValidationPipe(schema);

    expect(await pipe.transform({ email: 'me@example.com' }, meta())).toEqual({
      email: 'me@example.com',
    });
    await expect(pipe.transform({ email: 'me@elsewhere.com' }, meta())).rejects.toBeInstanceOf(
      ZodValidationException,
    );
  });
});
