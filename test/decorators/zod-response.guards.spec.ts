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

  it('throws TypeError on `type: [<non-DTO>]`', () => {
    expect(() => ZodResponse({ type: [NotADto as unknown as typeof Dto] })).toThrow(
      /element \[0\] is not a zod-nest DTO/,
    );
  });

  it('throws TypeError on `type: [Dto, <non-DTO>]`', () => {
    expect(() => ZodResponse({ type: [Dto, NotADto as unknown as typeof Dto] })).toThrow(
      /element \[1\] is not a zod-nest DTO/,
    );
  });

  it('throws TypeError on a bare Zod schema (not wrapped with createZodDto)', () => {
    expect(() =>
      ZodResponse({ type: z.object({ x: z.string() }) as unknown as typeof Dto }),
    ).toThrow(/must be a zod-nest DTO class/);
  });

  it('throws TypeError on a plain class (no ZOD_DTO_SYMBOL)', () => {
    expect(() => ZodResponse({ type: NotADto as unknown as typeof Dto })).toThrow(
      /must be a zod-nest DTO class/,
    );
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
});
