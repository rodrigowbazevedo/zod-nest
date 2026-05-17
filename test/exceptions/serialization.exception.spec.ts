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

  it('does NOT leak the zod error tree in the response body', () => {
    const zodErr = failingError();
    const err = new ZodSerializationException(zodErr);
    const body = err.getResponse() as Record<string, unknown>;

    expect(body).toEqual({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Response validation failed',
    });
    expect(body.errors).toBeUndefined();
    // The zodError is still accessible on the instance for filters / logging.
    expect(err.zodError).toBe(zodErr);
  });

  it('carries the executionContext when provided', () => {
    const ctx = { getType: () => 'http' } as unknown as NonNullable<
      ZodSerializationException['executionContext']
    >;
    const err = new ZodSerializationException(failingError(), ctx);
    expect(err.executionContext).toBe(ctx);
  });

  it('sets ES2022 cause to the original ZodError', () => {
    const zodErr = failingError();
    const err = new ZodSerializationException(zodErr);
    expect(err.cause).toBe(zodErr);
  });
});
