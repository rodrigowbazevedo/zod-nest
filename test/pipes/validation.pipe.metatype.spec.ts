import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

import { createZodDto, ZodValidationException, ZodValidationPipe } from '../../src';

const makeMetadata = (overrides: Partial<ArgumentMetadata> = {}): ArgumentMetadata => ({
  type: 'body',
  data: undefined,
  ...overrides,
});

describe('ZodValidationPipe — metatype-driven', () => {
  it('validates against the DTO schema when metatype is a ZodDto', async () => {
    const schema = z.object({ name: z.string() });
    class Meta_User_Dto extends createZodDto(schema, { id: 'Meta_User' }) {}
    const pipe = new ZodValidationPipe();

    const result = await pipe.transform({ name: 'Ada' }, makeMetadata({ metatype: Meta_User_Dto }));
    expect(result).toEqual({ name: 'Ada' });
  });

  it('throws ZodValidationException on invalid input', async () => {
    const schema = z.object({ name: z.string() });
    class Meta_Invalid_Dto extends createZodDto(schema, { id: 'Meta_Invalid' }) {}
    const pipe = new ZodValidationPipe();

    await expect(
      pipe.transform({ name: 42 }, makeMetadata({ metatype: Meta_Invalid_Dto })),
    ).rejects.toBeInstanceOf(ZodValidationException);
  });

  it('passes through when metatype is missing', async () => {
    const pipe = new ZodValidationPipe();
    const value = { whatever: true };
    expect(await pipe.transform(value, makeMetadata({ metatype: undefined }))).toBe(value);
  });

  it('passes through for primitive metatypes (String, Number, Boolean)', async () => {
    const pipe = new ZodValidationPipe();
    expect(await pipe.transform('hello', makeMetadata({ metatype: String }))).toBe('hello');
    expect(await pipe.transform(42, makeMetadata({ metatype: Number }))).toBe(42);
    expect(await pipe.transform(true, makeMetadata({ metatype: Boolean }))).toBe(true);
  });

  it('passes through for built-in container metatypes (Object, Array)', async () => {
    const pipe = new ZodValidationPipe();
    const arr = [1, 2, 3];
    const obj = { foo: 'bar' };
    expect(await pipe.transform(arr, makeMetadata({ metatype: Array }))).toBe(arr);
    expect(await pipe.transform(obj, makeMetadata({ metatype: Object }))).toBe(obj);
  });

  it('passes through for plain classes without ZOD_DTO_SYMBOL', async () => {
    class PlainDto {
      name = '';
    }
    const pipe = new ZodValidationPipe();
    const value = { name: 'Ada' };
    expect(await pipe.transform(value, makeMetadata({ metatype: PlainDto }))).toBe(value);
  });
});
