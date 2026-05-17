import 'reflect-metadata';

import { Get } from '@nestjs/common';
import { z } from 'zod';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';
import { getResponseVariants } from '../../src/response/metadata.js';

class Dto extends createZodDto(z.object({ a: z.string() }), { id: 'SchemaCache_Dto' }) {}

class Controller {
  @Get('single')
  @ZodResponse({ type: Dto })
  single(): void {}

  @Get('array')
  @ZodResponse({ type: [Dto] })
  array(): void {}

  @Get('tuple')
  @ZodResponse({ type: [Dto, Dto] })
  tuple(): void {}
}

describe('@ZodResponse — wrapped schema is built once at decoration time', () => {
  it('returns the same validationSchema instance across reads (single)', () => {
    const first = getResponseVariants(Controller.prototype.single)?.[0]?.validationSchema;
    const second = getResponseVariants(Controller.prototype.single)?.[0]?.validationSchema;
    expect(first).toBeDefined();
    expect(first).toBe(second);
    // single-kind reuses dto.schema directly.
    expect(first).toBe(Dto.schema);
  });

  it('returns the same validationSchema instance across reads (array)', () => {
    const first = getResponseVariants(Controller.prototype.array)?.[0]?.validationSchema;
    const second = getResponseVariants(Controller.prototype.array)?.[0]?.validationSchema;
    expect(first).toBeDefined();
    expect(first).toBe(second);
    // Wrapped — not the same reference as Dto.schema.
    expect(first).not.toBe(Dto.schema);
  });

  it('returns the same validationSchema instance across reads (tuple)', () => {
    const first = getResponseVariants(Controller.prototype.tuple)?.[0]?.validationSchema;
    const second = getResponseVariants(Controller.prototype.tuple)?.[0]?.validationSchema;
    expect(first).toBeDefined();
    expect(first).toBe(second);
    expect(first).not.toBe(Dto.schema);
  });
});
