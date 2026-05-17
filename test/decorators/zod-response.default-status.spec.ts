import 'reflect-metadata';

import { Delete, Get, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';
import { resolveEffectiveStatus } from '../../src/response/default-status.js';
import { getResponseVariants } from '../../src/response/metadata.js';

class Dto extends createZodDto(z.object({ a: z.string() }), { id: 'DefaultStatus_Dto' }) {}

class Routes {
  @Post()
  @ZodResponse({ type: Dto })
  create(): void {}

  @Get()
  @ZodResponse({ type: Dto })
  list(): void {}

  @Put()
  @ZodResponse({ type: Dto })
  replace(): void {}

  @Delete()
  @ZodResponse({ type: Dto })
  remove(): void {}

  @Patch()
  @ZodResponse({ type: Dto })
  amend(): void {}

  @Post()
  @ZodResponse({ status: HttpStatus.ACCEPTED, type: Dto })
  explicit(): void {}
}

const statusOf = (handler: object): number | undefined => {
  const variant = getResponseVariants(handler)?.[0];
  if (variant === undefined) {
    return undefined;
  }
  return resolveEffectiveStatus(variant, handler);
};

describe('@ZodResponse — default status by HTTP method', () => {
  it('POST → 201', () => {
    expect(statusOf(Routes.prototype.create)).toBe(201);
  });

  it('GET → 200', () => {
    expect(statusOf(Routes.prototype.list)).toBe(200);
  });

  it('PUT → 200', () => {
    expect(statusOf(Routes.prototype.replace)).toBe(200);
  });

  it('DELETE → 200', () => {
    expect(statusOf(Routes.prototype.remove)).toBe(200);
  });

  it('PATCH → 200', () => {
    expect(statusOf(Routes.prototype.amend)).toBe(200);
  });

  it('explicit `status` wins over the method default', () => {
    expect(statusOf(Routes.prototype.explicit)).toBe(HttpStatus.ACCEPTED);
  });

  it('stores `status: undefined` when omitted (lazy-resolution invariant)', () => {
    const variant = getResponseVariants(Routes.prototype.create)?.[0];
    expect(variant?.status).toBeUndefined();
  });

  it('stores the explicit `status` literally', () => {
    const variant = getResponseVariants(Routes.prototype.explicit)?.[0];
    expect(variant?.status).toBe(HttpStatus.ACCEPTED);
  });
});
