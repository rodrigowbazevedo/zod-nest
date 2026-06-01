import 'reflect-metadata';

import { z } from 'zod';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';

class Dto extends createZodDto(z.object({ a: z.string() }), { id: 'Guards_Dto' }) {}
class NotADto {}

describe('@ZodResponse — decoration-time guards', () => {
  it('throws TypeError on `type: []`', () => {
    expect(() => ZodResponse({ type: [] as unknown as [typeof Dto] })).toThrow(TypeError);
  });

  it('throws TypeError on `type: [<non-DTO, non-schema>]`', () => {
    expect(() => ZodResponse({ type: [NotADto as unknown as typeof Dto] })).toThrow(
      /element \[0\] must be a zod-nest DTO class/,
    );
  });

  it('throws TypeError on `type: [Dto, <non-DTO, non-schema>]`', () => {
    expect(() => ZodResponse({ type: [Dto, NotADto as unknown as typeof Dto] })).toThrow(
      /element \[1\] must be a zod-nest DTO class/,
    );
  });

  it('throws TypeError on a plain class (no ZOD_DTO_SYMBOL, not a schema)', () => {
    expect(() => ZodResponse({ type: NotADto as unknown as typeof Dto })).toThrow(
      /must be a zod-nest DTO class/,
    );
  });

  it('accepts a bare Zod schema (normalised to an output DTO internally)', () => {
    expect(() => ZodResponse({ type: z.object({ x: z.string() }) })).not.toThrow();
  });

  it('accepts a union / intersection / discriminatedUnion schema (createZodDto-unfriendly)', () => {
    expect(() =>
      ZodResponse({ type: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]) }),
    ).not.toThrow();
    expect(() =>
      ZodResponse({
        type: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a') }),
          z.object({ kind: z.literal('b') }),
        ]),
      }),
    ).not.toThrow();
  });

  it('accepts a valid single DTO', () => {
    expect(() => ZodResponse({ type: Dto })).not.toThrow();
  });

  it('accepts a valid array form `[Dto]`', () => {
    expect(() => ZodResponse({ type: [Dto] })).not.toThrow();
  });

  it('accepts a valid tuple form `[Dto, Dto]`', () => {
    expect(() => ZodResponse({ type: [Dto, Dto] })).not.toThrow();
  });

  it('accepts mixed arrays of DTOs and raw schemas', () => {
    expect(() => ZodResponse({ type: [Dto, z.object({ y: z.number() })] })).not.toThrow();
    expect(() => ZodResponse({ type: [z.object({ y: z.number() })] })).not.toThrow();
  });
});
