import { z } from 'zod';

import { createRegistry, toOpenApi, ZodNestUnrepresentableError } from '../../src';

describe('toOpenApi — strict mode', () => {
  const registry = createRegistry();

  it('strict default throws on z.symbol() with JSON path', () => {
    let thrown: unknown = undefined;
    try {
      toOpenApi(z.object({ s: z.symbol() }), { io: 'output', registry });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ZodNestUnrepresentableError);
    expect((thrown as ZodNestUnrepresentableError).path).toEqual(['properties', 's']);
  });

  it('strict: false emits `{}` for unrepresentable type', () => {
    const out = toOpenApi(z.object({ s: z.symbol() }), {
      io: 'output',
      registry,
      strict: false,
    }).schema;
    expect(out.properties?.s).toEqual({});
  });

  it('strict: true accepts z.any() (legitimate `{}` not flagged)', () => {
    const out = toOpenApi(z.any(), { io: 'output', registry }).schema;
    expect(out).toEqual({});
  });
});
