import { HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { z } from 'zod';

import type { ExecutionContext } from '@nestjs/common';

/**
 * Default exception thrown by `ZodSerializerInterceptor` in strict mode
 * (i.e. when `@ZodResponse({ passthroughOnError: true })` is NOT set) on
 * response-validation failure.
 *
 * Body shape (returned by `getResponse()`):
 * ```
 * {
 *   statusCode: 500,
 *   message: 'Response validation failed',
 *   errors: z.treeifyError(zodError),
 * }
 * ```
 *
 * Carries `zodError` and `executionContext` so custom exception filters
 * can introspect the original validation failure and the request that
 * produced it.
 */
export class ZodSerializationException extends InternalServerErrorException {
  readonly zodError: z.ZodError;
  readonly executionContext?: ExecutionContext;

  constructor(zodError: z.ZodError, executionContext?: ExecutionContext) {
    super({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Response validation failed',
      errors: z.treeifyError(zodError),
    });
    this.zodError = zodError;
    this.executionContext = executionContext;
  }
}
