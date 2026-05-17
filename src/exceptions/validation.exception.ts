import { BadRequestException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

/**
 * Default exception thrown by `ZodValidationPipe` when input fails to parse.
 *
 * Body shape (returned by `getResponse()`):
 * ```
 * {
 *   statusCode: 400,
 *   message: 'Validation failed',
 *   errors: z.treeifyError(zodError),
 * }
 * ```
 *
 * Carries `zodError` and `argMetadata` so custom exception filters can
 * introspect the original validation failure.
 */
export class ZodValidationException extends BadRequestException {
  readonly zodError: z.ZodError;
  readonly argMetadata?: ArgumentMetadata;

  constructor(zodError: z.ZodError, argMetadata?: ArgumentMetadata) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        errors: z.treeifyError(zodError),
      },
      { cause: zodError },
    );
    this.zodError = zodError;
    this.argMetadata = argMetadata;
  }
}
