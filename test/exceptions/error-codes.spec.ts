import { HttpException, HttpStatus } from '@nestjs/common';

import { ZodNestErrorCode } from '../../src';
import { errorCodeOptions, mirrorErrorCodeOntoBody } from '../../src/exceptions/error-codes';
import { expectedErrorCode } from './nest-error-code-support';

describe('ZodNestErrorCode', () => {
  it('exposes the default error codes', () => {
    expect(ZodNestErrorCode).toEqual({
      ValidationFailed: 'VALIDATION_FAILED',
      SerializationFailed: 'SERIALIZATION_FAILED',
    });
  });

  it('derives a literal union type from the values', () => {
    expectTypeOf<ZodNestErrorCode>().toEqualTypeOf<'VALIDATION_FAILED' | 'SERIALIZATION_FAILED'>();
  });
});

describe('errorCodeOptions', () => {
  it('pairs the cause with the error code', () => {
    const cause = new Error('boom');
    expect(errorCodeOptions(cause, ZodNestErrorCode.ValidationFailed)).toEqual({
      cause,
      errorCode: ZodNestErrorCode.ValidationFailed,
    });
  });
});

describe('mirrorErrorCodeOntoBody', () => {
  it('copies the exception errorCode onto the body when Nest set one', () => {
    const body: Record<string, unknown> = { message: 'x' };
    const exception = new HttpException(
      body,
      HttpStatus.BAD_REQUEST,
      errorCodeOptions(undefined, ZodNestErrorCode.ValidationFailed),
    );

    mirrorErrorCodeOntoBody(exception, body);

    expect(body).toEqual({
      message: 'x',
      errorCode: expectedErrorCode(ZodNestErrorCode.ValidationFailed),
    });
  });

  it('leaves the body untouched when the exception has no errorCode', () => {
    const body: Record<string, unknown> = { message: 'x' };
    const exception = new HttpException(body, HttpStatus.BAD_REQUEST);

    mirrorErrorCodeOntoBody(exception, body);

    expect(body).toStrictEqual({ message: 'x' });
  });
});
