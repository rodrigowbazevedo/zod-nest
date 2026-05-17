import { HttpStatus, InternalServerErrorException } from '@nestjs/common';

import type { ExecutionContext } from '@nestjs/common';
import type { z } from 'zod';

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
 * }
 * ```
 *
 * The zod error tree is **deliberately not exposed in the response body** —
 * a serialization failure is a server-side contract violation, and leaking
 * the schema-shape error tree to clients discloses internal structure. The
 * full treeified error is logged through `ZodNestModule`'s validation-log
 * channel (with redaction + truncation) so operators get the diagnostic
 * information without it reaching the wire.
 *
 * Custom exception filters can still introspect the failure: `zodError` and
 * `executionContext` are kept as own properties on the instance.
 */
export class ZodSerializationException extends InternalServerErrorException {
  readonly zodError: z.ZodError;
  readonly executionContext?: ExecutionContext;

  constructor(zodError: z.ZodError, executionContext?: ExecutionContext) {
    super(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Response validation failed',
      },
      { cause: zodError },
    );
    this.zodError = zodError;
    this.executionContext = executionContext;
  }
}
