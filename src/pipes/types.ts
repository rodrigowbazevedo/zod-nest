import type { ArgumentMetadata } from '@nestjs/common';
import type { z } from 'zod';
import type { ZodDto } from '../dto/dto.types.js';

/**
 * Build the exception thrown by `ZodValidationPipe` on validation failure.
 * Receives Zod's error and the NestJS argument metadata; returns anything
 * `throw`-able (typically a NestJS `HttpException` subclass).
 */
export type CreateValidationException = (
  zodError: z.ZodError,
  argMetadata: ArgumentMetadata,
) => unknown;

export interface ZodValidationPipeOptions {
  schema?: z.ZodType | ZodDto;
  createValidationException?: CreateValidationException;
}

/**
 * Constructor input for `ZodValidationPipe`. Discriminated at runtime:
 * - `undefined` → metatype-driven (read DTO from handler arg's metatype)
 * - a class with `[ZOD_DTO_SYMBOL]` → explicit DTO
 * - a Zod schema (has `_zod` internals) → raw schema
 * - anything else → options object
 */
export type ZodValidationPipeArg = z.ZodType | ZodDto | ZodValidationPipeOptions;
