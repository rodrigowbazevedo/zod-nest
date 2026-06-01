import { Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { ZodDto } from '../dto/dto.types.js';
import type { LogValidationFailure } from '../logging/validation-logger.js';
import type { CreateSerializationException, NormalizedZodNestOptions } from '../module/options.js';
import type { ResponseStatusWildcard, ResponseVariant } from '../response/metadata.js';
import type { StreamContentTypeMatcher } from '../response/stream.js';

import { ZodSerializationException } from '../exceptions/serialization.exception.js';
import { noopLogValidationFailure } from '../logging/validation-logger.js';
import { ZOD_NEST_OPTIONS } from '../module/options.js';
import { resolveEffectiveStatus } from '../response/default-status.js';
import { ZOD_RESPONSES_METADATA_KEY } from '../response/metadata.js';
import { DEFAULT_STREAM_MATCHER, isStreamResponse } from '../response/stream.js';

const defaultSerializationFactory: CreateSerializationException = (err, ctx) =>
  new ZodSerializationException(err, ctx);

// Label by `.id` (the OpenAPI component name) rather than `.name` (the class
// name): a DTO synthesised from a raw schema is an anonymous output sibling
// whose class name is the unhelpful `"SiblingClass"`, while its `.id` is the
// meaningful component id (from `.meta({ id })` or the anonymous fallback).
const formatDtoLabel = (variant: ResponseVariant): string => {
  if (variant.kind === 'single') {
    return (variant.dto as ZodDto).id;
  }
  const dtos = variant.dto as readonly ZodDto[];
  return `[${dtos.map((d) => d.id).join(', ')}]`;
};

const formatHandlerLabel = (context: ExecutionContext): string =>
  `${context.getClass().name}.${context.getHandler().name}`;

// '1XX' → 1, '2XX' → 2, etc. `charCodeAt(0) - 48` is the leading digit;
// `Math.floor(status / 100)` is the response's hundreds bucket.
const matchesWildcard = (wildcard: ResponseStatusWildcard, status: number): boolean =>
  wildcard.charCodeAt(0) - 48 === Math.floor(status / 100);

/**
 * Two-pass variant selection: exact numeric match wins outright, then the
 * `'NXX'` wildcard variants get a chance. Source order breaks ties within
 * each pass — first match wins, mirroring author intent (decorators apply
 * bottom-up but `appendResponseVariant` prepends, so the runtime array is
 * already in source order).
 */
const selectVariant = (
  variants: readonly ResponseVariant[],
  status: number,
  handler: object,
): ResponseVariant | undefined => {
  for (const variant of variants) {
    const effective = resolveEffectiveStatus(variant, handler);
    if (typeof effective === 'number' && effective === status) {
      return variant;
    }
  }
  for (const variant of variants) {
    const effective = resolveEffectiveStatus(variant, handler);
    if (typeof effective === 'string' && matchesWildcard(effective, status)) {
      return variant;
    }
  }
  return undefined;
};

@Injectable()
export class ZodSerializerInterceptor implements NestInterceptor {
  private readonly logOutputFailure: LogValidationFailure;
  private readonly createSerializationException: CreateSerializationException;
  private readonly streamMatcher: StreamContentTypeMatcher;

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(ZOD_NEST_OPTIONS) options?: NormalizedZodNestOptions,
  ) {
    this.logOutputFailure = options?.logOutputFailure ?? noopLogValidationFailure;
    this.createSerializationException =
      options?.createSerializationException ?? defaultSerializationFactory;
    // Falls back to built-in defaults when the module isn't configured
    // (`ZodSerializerInterceptor` used standalone, without `ZodNestModule`).
    this.streamMatcher = options?.streamMatcher ?? DEFAULT_STREAM_MATCHER;
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
    const variant = selectVariant(variants, status, handler);
    if (variant === undefined) {
      return value;
    }
    // Streams (SSE / NDJSON / binary) are written straight to the response
    // buffer — there's no single body to validate, so pass it through as-is.
    if (isStreamResponse(variant, handler, this.streamMatcher)) {
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
