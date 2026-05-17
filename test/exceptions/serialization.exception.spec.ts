import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ZodSerializationException } from '../../src';

const failingError = (): z.ZodError => {
  const schema = z.object({ name: z.string() });
  const result = schema.safeParse({ name: 42 });
  if (result.success) {
    throw new Error('fixture parsed unexpectedly');
  }
  return result.error;
};

describe('ZodSerializationException', () => {
  it('inherits InternalServerErrorException (status 500)', () => {
    const err = new ZodSerializationException(failingError());
    expect(err.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('exposes a treeified error body', () => {
    const zodErr = failingError();
    const err = new ZodSerializationException(zodErr);
    const body = err.getResponse();

    expect(body).toMatchObject({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Response validation failed',
      errors: z.treeifyError(zodErr),
    });
    expect(err.zodError).toBe(zodErr);
  });

  it('carries the executionContext when provided', () => {
    const ctx = { getType: () => 'http' } as unknown as NonNullable<
      ZodSerializationException['executionContext']
    >;
    const err = new ZodSerializationException(failingError(), ctx);
    expect(err.executionContext).toBe(ctx);
  });
});
