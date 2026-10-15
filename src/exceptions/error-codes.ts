import type { HttpException, HttpExceptionOptions } from '@nestjs/common';

/** Only populated under `@nestjs/common` >= 12. */
export const ZodNestErrorCode = {
  ValidationFailed: 'VALIDATION_FAILED',
  SerializationFailed: 'SERIALIZATION_FAILED',
} as const;

export type ZodNestErrorCode = (typeof ZodNestErrorCode)[keyof typeof ZodNestErrorCode];

// Intersection keeps the literal valid against Nest 11 types, which lack `errorCode`.
export const errorCodeOptions = (
  cause: unknown,
  errorCode: ZodNestErrorCode,
): HttpExceptionOptions & { errorCode: ZodNestErrorCode } => ({ cause, errorCode });

// Nest only adds errorCode to string bodies, so mirror it onto object bodies.
export const mirrorErrorCodeOntoBody = (
  exception: HttpException,
  body: Record<string, unknown>,
): void => {
  if (!('errorCode' in exception) || typeof exception.errorCode !== 'string') {
    return;
  }
  body.errorCode = exception.errorCode;
};
