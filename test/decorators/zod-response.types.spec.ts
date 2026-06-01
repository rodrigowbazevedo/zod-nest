import { expectTypeOf } from 'expect-type';
import { z } from 'zod';

import type { ZodDto, ZodResponseEntry, ZodResponseOptions, ZodResponseType } from '../../src';

import { ZodResponse } from '../../src';

// Compile-only checks. Locks the @ZodResponse public signature so a future
// refactor that widens / narrows the option object or changes the return
// type to something other than `MethodDecorator` fails to typecheck.

describe('@ZodResponse — type identity (compile-only)', () => {
  it('is callable with a `ZodResponseOptions` arg and returns a MethodDecorator', () => {
    expectTypeOf(ZodResponse).parameters.toEqualTypeOf<[ZodResponseOptions]>();
    expectTypeOf(ZodResponse).returns.toEqualTypeOf<MethodDecorator>();
    expect(true).toBe(true);
  });

  it('`ZodResponseType` admits a single ZodDto or a non-empty tuple of ZodDtos', () => {
    // Type-level structural check: the union has the shape we document.
    // No runtime DTO needed; the compiler verifies the union members exist.
    type Single = Extract<ZodResponseType, { schema: unknown }>;
    type Tuple = Exclude<ZodResponseType, { schema: unknown }>;
    expectTypeOf<Single>().not.toBeNever();
    expectTypeOf<Tuple>().not.toBeNever();
    expect(true).toBe(true);
  });

  it('`ZodResponseEntry` admits both a ZodDto and a raw Zod schema', () => {
    expectTypeOf<ZodDto>().toMatchTypeOf<ZodResponseEntry>();
    expectTypeOf<z.ZodType>().toMatchTypeOf<ZodResponseEntry>();
    expect(true).toBe(true);
  });

  it('a raw schema, and arrays mixing schemas and DTOs, are assignable to `ZodResponseType`', () => {
    expectTypeOf<z.ZodObject>().toMatchTypeOf<ZodResponseType>();
    expectTypeOf<readonly [z.ZodType]>().toMatchTypeOf<ZodResponseType>();
    expectTypeOf<readonly [ZodDto, z.ZodType]>().toMatchTypeOf<ZodResponseType>();
    expect(true).toBe(true);
  });
});
