import { expectTypeOf } from 'expect-type';

import type { PipeTransform } from '@nestjs/common';

import { ZodValidationPipe } from '../../src';

// Compile-only checks. Locks the pipe's public type identity — if the class
// stops implementing `PipeTransform` (e.g. signature drift on `transform`),
// this file fails to typecheck.

describe('ZodValidationPipe — type identity (compile-only)', () => {
  it('implements NestJS `PipeTransform`', () => {
    expectTypeOf<ZodValidationPipe>().toMatchTypeOf<PipeTransform>();
    expect(true).toBe(true);
  });

  it('exposes a `transform` method with the PipeTransform signature', () => {
    expectTypeOf<ZodValidationPipe['transform']>().toMatchTypeOf<PipeTransform['transform']>();
    expect(true).toBe(true);
  });
});
