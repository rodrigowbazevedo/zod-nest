import { z } from 'zod';

import { createZodDto, isZodDto } from '../../src';
import { toResponseDto } from '../../src/response/normalize-type.js';

describe('toResponseDto', () => {
  it('returns a passed DTO unchanged (no re-wrapping)', () => {
    class NormDto extends createZodDto(z.object({ a: z.string() }), { id: 'Norm_Passthrough' }) {}
    expect(toResponseDto(NormDto)).toBe(NormDto);
  });

  it('wraps a raw schema into an output-side DTO', () => {
    const schema = z.object({ a: z.string() }).meta({ id: 'Norm_RawObject' });
    const dto = toResponseDto(schema);
    expect(isZodDto(dto)).toBe(true);
    expect(dto.io).toBe('output');
    expect(dto.schema).toBe(schema);
    expect(dto.id).toBe('Norm_RawObject');
  });

  it('returns the same DTO instance for the same schema reused across calls (cache)', () => {
    const schema = z.object({ a: z.string() }).meta({ id: 'Norm_Cached' });
    expect(toResponseDto(schema)).toBe(toResponseDto(schema));
  });

  it('gives an unnamed schema a generated id (not the shared base class name) and warns once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const dto = toResponseDto(z.object({ a: z.string() }));
      expect(dto.id).toMatch(/^_AnonZodResponseSchema_\d+$/);
      const other = toResponseDto(z.object({ b: z.number() }));
      // Distinct unnamed schemas get distinct ids — they must not collapse onto
      // the shared "ZodDtoBase" class name.
      expect(other.id).not.toBe(dto.id);
    } finally {
      warn.mockRestore();
    }
  });

  it('accepts union / intersection / discriminatedUnion schemas (TS2509 cases — runtime, no extends)', () => {
    const union = z.union([z.string(), z.number()]).meta({ id: 'Norm_Union' });
    const intersection = z
      .intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))
      .meta({ id: 'Norm_Intersection' });
    const discriminated = z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), a: z.string() }),
        z.object({ kind: z.literal('b'), b: z.number() }),
      ])
      .meta({ id: 'Norm_Discriminated' });

    for (const schema of [union, intersection, discriminated]) {
      const dto = toResponseDto(schema);
      expect(isZodDto(dto)).toBe(true);
      expect(dto.schema).toBe(schema);
    }
  });

  it('throws TypeError on a non-DTO / non-schema value', () => {
    class NotADto {}
    expect(() => toResponseDto(NotADto)).toThrow(/must be a zod-nest DTO class/);
    expect(() => toResponseDto({})).toThrow(TypeError);
  });

  it('includes the array index in the error message when supplied', () => {
    expect(() => toResponseDto({}, 2)).toThrow(/element \[2\]/);
  });
});
