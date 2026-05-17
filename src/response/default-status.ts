import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';

import type { ResponseVariant } from './metadata.js';

const POST_DEFAULT_STATUS = 201;
const GENERIC_DEFAULT_STATUS = 200;

/**
 * Compute the default HTTP status code for a handler when `@ZodResponse(...)`
 * is invoked without an explicit `status`. Mirrors NestJS' own defaults:
 * POST → 201, everything else (and missing method metadata) → 200.
 *
 * Reads `METHOD_METADATA` set by NestJS' route decorators (`@Get`, `@Post`,
 * etc.). The fallback to 200 when the key is missing is intentional and
 * pinned by tests so a future NestJS rename surfaces as a test failure
 * rather than a silent regression.
 */
export const defaultStatusFor = (handler: object): number => {
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
  if (method === RequestMethod.POST) {
    return POST_DEFAULT_STATUS;
  }
  return GENERIC_DEFAULT_STATUS;
};

/**
 * Resolve the effective status code for a variant. `variant.status` may be
 * `undefined` because `@ZodResponse` runs before NestJS' route decorators
 * — defer the default-by-method lookup until the interceptor reads it.
 */
export const resolveEffectiveStatus = (variant: ResponseVariant, handler: object): number => {
  if (variant.status !== undefined) {
    return variant.status;
  }
  return defaultStatusFor(handler);
};
