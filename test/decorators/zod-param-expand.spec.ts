import { z } from 'zod';

import { expandObjectSchema, isZodObject } from '../../src/decorators/internal/zod-param-expand.js';
import { ZodNestError } from '../../src/schema/errors.js';

describe('expandObjectSchema', () => {
  it('expands each top-level property into a param entry, respecting optionality', () => {
    const schema = z.object({ q: z.string(), limit: z.number().optional() });

    const params = expandObjectSchema(schema, { decoratorName: '@Test' });

    expect(params.map((p) => p.name).sort()).toEqual(['limit', 'q']);
    expect(params.find((p) => p.name === 'q')?.required).toBe(true);
    expect(params.find((p) => p.name === 'limit')?.required).toBe(false);
  });

  it('falls back to defaultRegistry when no registry option is given', () => {
    // No `registry` in options → exercises the `options.registry ?? defaultRegistry`
    // fallback. Anonymous schema so nothing is written to the global registry.
    const params = expandObjectSchema(z.object({ a: z.string() }), { decoratorName: '@Test' });
    expect(params.map((p) => p.name)).toEqual(['a']);
  });

  it('forces required when forceRequired is set (path params)', () => {
    const schema = z.object({ id: z.string().optional() });
    const params = expandObjectSchema(schema, { decoratorName: '@Param', forceRequired: true });
    expect(params[0]?.required).toBe(true);
  });

  it('throws ZodNestError for a non-object schema', () => {
    expect(() => expandObjectSchema(z.string(), { decoratorName: '@Test' })).toThrow(ZodNestError);
  });

  it('isZodObject narrows z.object vs other schema types', () => {
    expect(isZodObject(z.object({}))).toBe(true);
    expect(isZodObject(z.string())).toBe(false);
  });
});
