import { z } from 'zod';

import { createZodDto, isZodSchema } from '../../src';

describe('isZodSchema', () => {
  it('accepts object / primitive schemas', () => {
    expect(isZodSchema(z.object({ x: z.string() }))).toBe(true);
    expect(isZodSchema(z.string())).toBe(true);
    expect(isZodSchema(z.number())).toBe(true);
  });

  it('accepts union / intersection / discriminatedUnion schemas (the createZodDto-unfriendly ones)', () => {
    expect(isZodSchema(z.union([z.string(), z.number()]))).toBe(true);
    expect(
      isZodSchema(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))),
    ).toBe(true);
    expect(
      isZodSchema(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a') }),
          z.object({ kind: z.literal('b') }),
        ]),
      ),
    ).toBe(true);
  });

  it('rejects a zod-nest DTO class (it is a constructor, not a schema)', () => {
    class IsZodSchema_Dto extends createZodDto(z.object({ x: z.string() }), {
      id: 'IsZodSchema_Dto',
    }) {}
    expect(isZodSchema(IsZodSchema_Dto)).toBe(false);
  });

  it('rejects null, undefined, primitives, plain objects, and constructors', () => {
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema(undefined)).toBe(false);
    expect(isZodSchema(42)).toBe(false);
    expect(isZodSchema('z.string()')).toBe(false);
    expect(isZodSchema({})).toBe(false);
    expect(isZodSchema([])).toBe(false);
    expect(isZodSchema(String)).toBe(false);
  });
});
