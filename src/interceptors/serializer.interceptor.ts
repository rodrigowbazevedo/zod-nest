import { Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { ZodDto } from '../dto/dto.types.js';
import type { LogValidationFailure } from '../logging/validation-logger.js';
import type { CreateSerializationException, NormalizedZodNestOptions } from '../module/options.js';
import type { ResponseVariant } from '../response/metadata.js';

import { ZodSerializationException } from '../exceptions/serialization.exception.js';
import { noopLogValidationFailure } from '../logging/validation-logger.js';
import { ZOD_NEST_OPTIONS } from '../module/options.js';
import { resolveEffectiveStatus } from '../response/default-status.js';
import { ZOD_RESPONSES_METADATA_KEY } from '../response/metadata.js';

const defaultSerializationFactory: CreateSerializationException = (err, ctx) =>
  new ZodSerializationException(err, ctx);

const formatDtoLabel = (variant: ResponseVariant): string => {
  if (variant.kind === 'single') {
    return (variant.dto as ZodDto).name;
  }
  const dtos = variant.dto as readonly ZodDto[];
  return `[${dtos.map((d) => d.name).join(', ')}]`;
};

const formatHandlerLabel = (context: ExecutionContext): string =>
  `${context.getClass().name}.${context.getHandler().name}`;

@Injectable()
export class ZodSerializerInterceptor implements NestInterceptor {
  private readonly logOutputFailure: LogValidationFailure;
  private readonly createSerializationException: CreateSerializationException;

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(ZOD_NEST_OPTIONS) options?: NormalizedZodNestOptions,
  ) {
    this.logOutputFailure = options?.logOutputFailure ?? noopLogValidationFailure;
    this.createSerializationException =
      options?.createSerializationException ?? defaultSerializationFactory;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const handler = context.getHandler();
    const variants = this.reflector.get<readonly ResponseVariant[] | undefined>(
      ZOD_RESPONSES_METADATA_KEY,
      handler,
    );
    if (variants === undefined || variants.length === 0) {
      return next.handle();
    }
    return next
      .handle()
      .pipe(mergeMap((value) => from(this.transform(value, variants, context, handler))));
  }

  private async transform(
    value: unknown,
    variants: readonly ResponseVariant[],
    context: ExecutionContext,
    handler: object,
  ): Promise<unknown> {
    const response = context.switchToHttp().getResponse<{ statusCode?: number }>();
    const status = response.statusCode;
    if (status === undefined) {
      return value;
    }
    const variant = variants.find((v) => resolveEffectiveStatus(v, handler) === status);
    if (variant === undefined) {
      return value;
    }
    const result = await variant.validationSchema.safeParseAsync(value);
    if (result.success) {
      return result.data;
    }
    const isSoft = variant.passthroughOnError;
    this.logOutputFailure(result.error, value, {
      side: 'output',
      severity: isSoft ? 'warn' : 'error',
      dto: formatDtoLabel(variant),
      status,
      handler: formatHandlerLabel(context),
    });
    if (isSoft) {
      return value;
    }
    throw this.createSerializationException(result.error, context);
  }
}
