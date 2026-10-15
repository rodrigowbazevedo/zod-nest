import { HttpException, HttpStatus } from '@nestjs/common';

import { ZodNestErrorCode } from '../../src';
import { errorCodeOptions } from '../../src/exceptions/error-codes';

export const errorCodeOf = (exception: HttpException): unknown =>
  'errorCode' in exception ? exception.errorCode : undefined;

const nestSupportsErrorCode =
  errorCodeOf(
    new HttpException(
      'probe',
      HttpStatus.BAD_REQUEST,
      errorCodeOptions(undefined, ZodNestErrorCode.ValidationFailed),
    ),
  ) === ZodNestErrorCode.ValidationFailed;

export const expectedErrorCode = (errorCode: ZodNestErrorCode): ZodNestErrorCode | undefined =>
  nestSupportsErrorCode ? errorCode : undefined;
