import { z } from 'zod';

import { createRegistry, toOpenApi } from '../../src';

describe('toOpenApi — modifiers', () => {
  const registry = createRegistry();
  const opts = { io: 'output' as const, registry };

  it('optional unwraps to inner', () => {
    const schema = z.object({ a: z.string().optional() });
    const out = toOpenApi(schema, opts).schema;
    expect(out.properties).toEqual({ a: { type: 'string' } });
    expect(out.required).toBeUndefined();
  });

  it('nullable → anyOf with null', () => {
    const schema = z.string().nullable();
    const out = toOpenApi(schema, opts).schema;
    expect(out.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
  });

  it('default is preserved on output', () => {
    const schema = z.string().default('x');
    const out = toOpenApi(schema, opts).schema;
    expect(out.type).toBe('string');
    expect(out.default).toBe('x');
  });

  it('refine is transparent (no JSON Schema effect)', () => {
    const schema = z.string().refine((v) => v.length > 0, 'non-empty');
    expect(toOpenApi(schema, opts).schema).toEqual({ type: 'string' });
  });

  it('pipe input emits the input shape', () => {
    const schema = z
      .string()
      .transform((v) => Number(v))
      .pipe(z.number());
    const out = toOpenApi(schema, { ...opts, io: 'input' }).schema;
    expect(out.type).toBe('string');
  });

  it('pipe output emits the output shape', () => {
    const schema = z
      .string()
      .transform((v) => Number(v))
      .pipe(z.number());
    const out = toOpenApi(schema, { ...opts, io: 'output' }).schema;
    expect(out.type).toBe('number');
  });
});
