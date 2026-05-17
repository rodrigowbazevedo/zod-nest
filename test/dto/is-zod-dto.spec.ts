import { z } from 'zod';

import { createZodDto, isZodDto } from '../../src';

describe('isZodDto', () => {
  it('accepts a class returned by createZodDto', () => {
    class IsZodDto_Pos_Dto extends createZodDto(z.object({ x: z.string() }), {
      id: 'IsZodDto_Pos',
    }) {}
    expect(isZodDto(IsZodDto_Pos_Dto)).toBe(true);
  });

  it('accepts the output sibling class', () => {
    class IsZodDto_Out_Dto extends createZodDto(z.object({ x: z.string() }), {
      id: 'IsZodDto_Out',
    }) {}
    expect(isZodDto(IsZodDto_Out_Dto.Output)).toBe(true);
  });

  it('rejects plain classes without the symbol', () => {
    class PlainDto {}
    expect(isZodDto(PlainDto)).toBe(false);
  });

  it('rejects null, undefined, primitives, and plain objects', () => {
    expect(isZodDto(null)).toBe(false);
    expect(isZodDto(undefined)).toBe(false);
    expect(isZodDto(42)).toBe(false);
    expect(isZodDto('UserDto')).toBe(false);
    expect(isZodDto({})).toBe(false);
    expect(isZodDto([])).toBe(false);
  });

  it('rejects built-in constructors (String, Number, Boolean, Object, Array)', () => {
    expect(isZodDto(String)).toBe(false);
    expect(isZodDto(Number)).toBe(false);
    expect(isZodDto(Boolean)).toBe(false);
    expect(isZodDto(Object)).toBe(false);
    expect(isZodDto(Array)).toBe(false);
  });
});
