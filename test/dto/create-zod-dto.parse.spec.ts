import { z } from 'zod';

import { createZodDto } from '../../src';

describe('createZodDto — parse / safeParse', () => {
  const schema = z.object({ id: z.uuid(), name: z.string() });
  class Parse_UserDto extends createZodDto(schema, { id: 'Parse_User' }) {}

  it('parse round-trips a valid input', () => {
    const value = { id: '00000000-0000-0000-0000-000000000000', name: 'Ada' };
    expect(Parse_UserDto.parse(value)).toEqual(value);
  });

  it('parse throws a ZodError on invalid input', () => {
    expect(() => Parse_UserDto.parse({ id: 'not-a-uuid', name: 1 })).toThrow(z.ZodError);
  });

  it('safeParse returns { success: true, data } on valid input', () => {
    const value = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Linus' };
    const result = Parse_UserDto.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(value);
    }
  });

  it('safeParse returns { success: false, error } on invalid input', () => {
    const result = Parse_UserDto.safeParse({ id: 'bogus', name: 42 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });

  it('exposes the original schema reference unchanged', () => {
    expect(Parse_UserDto.schema).toBe(schema);
  });
});
