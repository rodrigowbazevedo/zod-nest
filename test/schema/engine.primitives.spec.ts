import { z } from 'zod';

import { createRegistry, toOpenApi, ZodNestUnrepresentableError } from '../../src';

describe('toOpenApi — primitives', () => {
  const registry = createRegistry();

  it('string', () => {
    expect(toOpenApi(z.string(), { io: 'output', registry }).schema).toEqual({ type: 'string' });
  });

  it('number', () => {
    expect(toOpenApi(z.number(), { io: 'output', registry }).schema).toEqual({ type: 'number' });
  });

  it('integer', () => {
    expect(toOpenApi(z.int(), { io: 'output', registry }).schema).toEqual({
      type: 'integer',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
  });

  it('boolean', () => {
    expect(toOpenApi(z.boolean(), { io: 'output', registry }).schema).toEqual({ type: 'boolean' });
  });

  it('null', () => {
    expect(toOpenApi(z.null(), { io: 'output', registry }).schema).toEqual({ type: 'null' });
  });

  it('bigint via built-in override → integer', () => {
    expect(toOpenApi(z.bigint(), { io: 'output', registry }).schema).toEqual({ type: 'integer' });
  });

  it('date via built-in override → string/date-time', () => {
    expect(toOpenApi(z.date(), { io: 'output', registry }).schema).toEqual({
      type: 'string',
      format: 'date-time',
    });
  });

  it('symbol throws ZodNestUnrepresentableError in strict mode (default)', () => {
    expect(() => toOpenApi(z.symbol(), { io: 'output', registry })).toThrow(
      ZodNestUnrepresentableError,
    );
  });

  it('symbol emits `{}` when strict is false', () => {
    expect(toOpenApi(z.symbol(), { io: 'output', registry, strict: false }).schema).toEqual({});
  });

  it('strips $schema from output', () => {
    const out = toOpenApi(z.string(), { io: 'output', registry }).schema;
    expect(out).not.toHaveProperty('$schema');
  });
});
