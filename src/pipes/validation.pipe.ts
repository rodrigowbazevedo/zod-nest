import { Injectable, Optional } from '@nestjs/common';

import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import type { ZodDto } from '../dto/dto.types.js';
import type {
  CreateValidationException,
  ZodValidationPipeArg,
  ZodValidationPipeOptions,
} from './types.js';

import { ZOD_DTO_SYMBOL } from '../dto/symbols.js';
import { ZodValidationException } from '../exceptions/validation.exception.js';

const isZodDtoClass = (value: unknown): value is ZodDto =>
  typeof value === 'function' &&
  (value as unknown as Record<symbol, unknown>)[ZOD_DTO_SYMBOL] === true;

const isZodSchema = (value: unknown): value is z.ZodType =>
  value !== null && typeof value === 'object' && '_zod' in value;

const isOptionsObject = (value: unknown): value is ZodValidationPipeOptions =>
  value !== null && typeof value === 'object' && !isZodSchema(value);

const defaultExceptionFactory: CreateValidationException = (zodError, argMetadata) =>
  new ZodValidationException(zodError, argMetadata);

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  private readonly explicitSchema: z.ZodType | undefined;
  private readonly createValidationException: CreateValidationException;

  constructor(@Optional() arg?: ZodValidationPipeArg) {
    const { schema, factory } = ZodValidationPipe.parseArg(arg);
    this.explicitSchema = schema;
    this.createValidationException = factory;
  }

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const schema = this.resolveSchema(metadata);
    if (schema === undefined) {
      return value;
    }
    const result = await schema.safeParseAsync(value);
    if (result.success) {
      return result.data;
    }
    throw this.createValidationException(result.error, metadata);
  }

  private resolveSchema(metadata: ArgumentMetadata): z.ZodType | undefined {
    if (this.explicitSchema !== undefined) {
      return this.explicitSchema;
    }
    const metatype: unknown = metadata.metatype;
    if (!isZodDtoClass(metatype)) {
      return undefined;
    }
    return metatype.schema;
  }

  private static parseArg(arg: ZodValidationPipeArg | undefined): {
    schema: z.ZodType | undefined;
    factory: CreateValidationException;
  } {
    if (arg === undefined) {
      return { schema: undefined, factory: defaultExceptionFactory };
    }
    if (isZodDtoClass(arg)) {
      return { schema: arg.schema, factory: defaultExceptionFactory };
    }
    if (isZodSchema(arg)) {
      return { schema: arg, factory: defaultExceptionFactory };
    }
    if (!isOptionsObject(arg)) {
      return { schema: undefined, factory: defaultExceptionFactory };
    }
    const optionSchema = arg.schema;
    const resolvedSchema = isZodDtoClass(optionSchema) ? optionSchema.schema : optionSchema;
    return {
      schema: resolvedSchema,
      factory: arg.createValidationException ?? defaultExceptionFactory,
    };
  }
}
