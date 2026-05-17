import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA } from '@nestjs/common/constants';

import type { ResponseVariant } from './metadata.js';

const POST_DEFAULT_STATUS = 201;
const GENERIC_DEFAULT_STATUS = 200;

/**
 * Compute the default HTTP status code for a handler when `@ZodResponse(...)`
 * is invoked without an explicit `status`. Lookup order (highest → lowest):
 *
 * 1. `@HttpCode(n)` on the handler — explicit per-handler status override.
 *    NestJS sets `HTTP_CODE_METADATA` to the numeric status when present.
 * 2. HTTP method default — `POST` → `201`, everything else → `200`.
 *
 * The method default itself falls back to `200` when `METHOD_METADATA` is
 * absent — pinned by tests so a future NestJS rename surfaces as a test
 * failure rather than a silent regression.
 */
export const defaultStatusFor = (handler: object): number => {
  const httpCode = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
  if (typeof httpCode === 'number') {
    return httpCode;
  }
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
  if (method === RequestMethod.POST) {
    return POST_DEFAULT_STATUS;
  }
  return GENERIC_DEFAULT_STATUS;
};

/**
 * Resolve the effective status code for a variant. Precedence chain:
 *
 * 1. Explicit `@ZodResponse({ status })` on the decorator call — `variant.status`.
 * 2. `@HttpCode(n)` on the handler — read via `defaultStatusFor()` at runtime.
 * 3. HTTP method default (POST → 201, others → 200) — also via `defaultStatusFor()`.
 *
 * Resolution is deferred to request time because `@ZodResponse` runs before
 * NestJS' route + `@HttpCode` decorators — none of their metadata is set
 * when the decorator evaluates.
 */
export const resolveEffectiveStatus = (variant: ResponseVariant, handler: object): number => {
  if (variant.status !== undefined) {
    return variant.status;
  }
  return defaultStatusFor(handler);
};
