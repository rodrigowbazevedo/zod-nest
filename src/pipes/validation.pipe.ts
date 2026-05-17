import { Inject, Injectable, Optional } from '@nestjs/common';

import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import type { LogValidationFailure } from '../logging/validation-logger.js';
import type { NormalizedZodNestOptions } from '../module/options.js';
import type {
  CreateValidationException,
  ZodValidationPipeArg,
  ZodValidationPipeOptions,
} from './types.js';

import { isZodDto } from '../dto/predicates.js';
import { ZodValidationException } from '../exceptions/validation.exception.js';
import { noopLogValidationFailure } from '../logging/validation-logger.js';
import { ZOD_NEST_OPTIONS } from '../module/options.js';

const isZodSchema = (value: unknown): value is z.ZodType =>
  value !== null && typeof value === 'object' && '_zod' in value;

const isOptionsObject = (value: unknown): value is ZodValidationPipeOptions =>
  value !== null && typeof value === 'object' && !isZodSchema(value);

const defaultExceptionFactory: CreateValidationException = (zodError, argMetadata) =>
  new ZodValidationException(zodError, argMetadata);

interface ParsedArg {
  schema: z.ZodType | undefined;
  factory: CreateValidationException | undefined;
  dtoName: string | undefined;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  private readonly explicitSchema: z.ZodType | undefined;
  private readonly explicitDtoName: string | undefined;
  private readonly createValidationException: CreateValidationException;
  private readonly logInputFailure: LogValidationFailure;

  constructor(
    @Optional() arg?: ZodValidationPipeArg,
    @Optional() @Inject(ZOD_NEST_OPTIONS) moduleOptions?: NormalizedZodNestOptions,
  ) {
    const parsed = ZodValidationPipe.parseArg(arg);
    this.explicitSchema = parsed.schema;
    this.explicitDtoName = parsed.dtoName;
    this.createValidationException =
      parsed.factory ?? moduleOptions?.createValidationException ?? defaultExceptionFactory;
    this.logInputFailure = moduleOptions?.logInputFailure ?? noopLogValidationFailure;
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
    this.logInputFailure(result.error, value, {
      side: 'input',
      severity: 'warn',
      dto: this.resolveDtoLabel(metadata),
      argType: metadata.type,
    });
    throw this.createValidationException(result.error, metadata);
  }

  private resolveSchema(metadata: ArgumentMetadata): z.ZodType | undefined {
    if (this.explicitSchema !== undefined) {
      return this.explicitSchema;
    }
    const metatype: unknown = metadata.metatype;
    if (!isZodDto(metatype)) {
      return undefined;
    }
    return metatype.schema;
  }

  private resolveDtoLabel(metadata: ArgumentMetadata): string {
    if (this.explicitDtoName !== undefined) {
      return this.explicitDtoName;
    }
    const metatype: unknown = metadata.metatype;
    if (isZodDto(metatype)) {
      return metatype.name;
    }
    return 'schema';
  }

  private static parseArg(arg: ZodValidationPipeArg | undefined): ParsedArg {
    if (arg === undefined) {
      return { schema: undefined, factory: undefined, dtoName: undefined };
    }
    if (isZodDto(arg)) {
      return { schema: arg.schema, factory: undefined, dtoName: arg.name };
    }
    if (isZodSchema(arg)) {
      return { schema: arg, factory: undefined, dtoName: undefined };
    }
    if (!isOptionsObject(arg)) {
      return { schema: undefined, factory: undefined, dtoName: undefined };
    }
    const optionSchema = arg.schema;
    const dtoName = isZodDto(optionSchema) ? optionSchema.name : undefined;
    const resolvedSchema = isZodDto(optionSchema) ? optionSchema.schema : optionSchema;
    return {
      schema: resolvedSchema,
      factory: arg.createValidationException,
      dtoName,
    };
  }
}
