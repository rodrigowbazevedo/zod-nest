import { expectTypeOf } from 'expect-type';

import type { NestInterceptor } from '@nestjs/common';

import { ZodSerializerInterceptor } from '../../src';

// Compile-only checks. Locks the interceptor's public type identity — if the
// class stops implementing `NestInterceptor`, this file fails to typecheck.

describe('ZodSerializerInterceptor — type identity (compile-only)', () => {
  it('implements NestJS `NestInterceptor`', () => {
    expectTypeOf<ZodSerializerInterceptor>().toMatchTypeOf<NestInterceptor>();
    expect(true).toBe(true);
  });

  it('exposes an `intercept` method with the NestInterceptor signature', () => {
    expectTypeOf<ZodSerializerInterceptor['intercept']>().toMatchTypeOf<
      NestInterceptor['intercept']
    >();
    expect(true).toBe(true);
  });
});
