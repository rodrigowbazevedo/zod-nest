import { BadRequestException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

import { ZodValidationException } from '../../src';

const failingError = (): z.ZodError => {
  const schema = z.object({ name: z.string() });
  const result = schema.safeParse({ name: 42 });
  if (result.success) {
    throw new Error('fixture parsed unexpectedly');
  }
  return result.error;
};

describe('ZodValidationException', () => {
  it('inherits BadRequestException (status 400)', () => {
    const err = new ZodValidationException(failingError());
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('exposes a treeified error body', () => {
    const zodErr = failingError();
    const err = new ZodValidationException(zodErr);
    const body = err.getResponse();

    expect(body).toMatchObject({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Validation failed',
      errors: z.treeifyError(zodErr),
    });
    expect(err.zodError).toBe(zodErr);
  });

  it('carries the argMetadata when provided', () => {
    const meta: ArgumentMetadata = { type: 'body', data: 'body', metatype: undefined };
    const err = new ZodValidationException(failingError(), meta);
    expect(err.argMetadata).toEqual(meta);
  });

  it('sets ES2022 cause to the original ZodError', () => {
    const zodErr = failingError();
    const err = new ZodValidationException(zodErr);
    expect(err.cause).toBe(zodErr);
  });
});
