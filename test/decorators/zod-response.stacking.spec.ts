import 'reflect-metadata';

import { Get, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';
import { getResponseVariants } from '../../src/response/metadata.js';

class UserDto extends createZodDto(z.object({ id: z.string() }), { id: 'Stacking_User' }) {}
class ErrorDto extends createZodDto(z.object({ code: z.number() }), { id: 'Stacking_Error' }) {}
class FatalDto extends createZodDto(z.object({ trace: z.string() }), { id: 'Stacking_Fatal' }) {}

class Controller {
  @Get(':id')
  @ZodResponse({ status: HttpStatus.OK, type: UserDto })
  @ZodResponse({ status: HttpStatus.NOT_FOUND, type: ErrorDto })
  @ZodResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, type: FatalDto })
  getUser(): void {}

  @Get('list')
  @ZodResponse({ type: [UserDto] })
  list(): void {}

  @Get('pair')
  @ZodResponse({ type: [UserDto, ErrorDto] })
  pair(): void {}
}

describe('@ZodResponse — stacking', () => {
  it('produces a metadata array in author order across three single-kind variants', () => {
    const variants = getResponseVariants(Controller.prototype.getUser);
    expect(variants?.map((v) => v.status)).toEqual([
      HttpStatus.OK,
      HttpStatus.NOT_FOUND,
      HttpStatus.INTERNAL_SERVER_ERROR,
    ]);
    expect(variants?.map((v) => v.kind)).toEqual(['single', 'single', 'single']);
    expect(variants?.map((v) => v.dto)).toEqual([UserDto, ErrorDto, FatalDto]);
  });

  it('records `array` kind with a length-1 type list and a z.array() validation schema', () => {
    const [variant] = getResponseVariants(Controller.prototype.list) ?? [];
    expect(variant?.kind).toBe('array');
    expect(variant?.dto).toEqual([UserDto]);
    expect(variant?.validationSchema.safeParse([{ id: 'a' }]).success).toBe(true);
    expect(variant?.validationSchema.safeParse({ id: 'a' }).success).toBe(false);
  });

  it('records `tuple` kind with a length-≥2 type list and a z.tuple() validation schema', () => {
    const [variant] = getResponseVariants(Controller.prototype.pair) ?? [];
    expect(variant?.kind).toBe('tuple');
    expect(variant?.dto).toEqual([UserDto, ErrorDto]);
    expect(variant?.validationSchema.safeParse([{ id: 'a' }, { code: 1 }]).success).toBe(true);
    expect(variant?.validationSchema.safeParse([{ id: 'a' }]).success).toBe(false);
  });

  it('defaults passthroughOnError to false when not specified', () => {
    const variants = getResponseVariants(Controller.prototype.getUser) ?? [];
    for (const variant of variants) {
      expect(variant.passthroughOnError).toBe(false);
    }
  });
});
