import { z } from 'zod';

import { createRegistry, toOpenApi } from '../../src';

describe('toOpenApi — input/output divergence', () => {
  const registry = createRegistry();

  it('transform via pipe produces different input vs output shapes', () => {
    const schema = z
      .string()
      .transform((v) => Number(v))
      .pipe(z.number());
    const inputOut = toOpenApi(schema, { io: 'input', registry }).schema;
    const outputOut = toOpenApi(schema, { io: 'output', registry }).schema;

    expect(inputOut).toEqual({ type: 'string' });
    expect(outputOut).toEqual({ type: 'number' });
  });
});
