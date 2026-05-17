import { z } from 'zod';

import type { Override } from '../../src';

import { createRegistry, toOpenApi } from '../../src';

describe('toOpenApi — override precedence', () => {
  const registry = createRegistry();

  it('built-in date override applies when no user override is provided', () => {
    expect(toOpenApi(z.date(), { io: 'output', registry }).schema).toEqual({
      type: 'string',
      format: 'date-time',
    });
  });

  it('user override runs after built-in and wins on the same node', () => {
    const userOverride: Override = ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === 'date') {
        jsonSchema.format = 'date'; // override built-in date-time
      }
    };
    const out = toOpenApi(z.date(), { io: 'output', registry, override: userOverride }).schema;
    expect(out.format).toBe('date');
  });

  it('user override can supply a custom mapping for an unrepresentable type', () => {
    const userOverride: Override = ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === 'symbol') {
        jsonSchema.type = 'string';
        jsonSchema.format = 'symbol';
      }
    };
    const out = toOpenApi(z.symbol(), { io: 'output', registry, override: userOverride }).schema;
    expect(out).toEqual({ type: 'string', format: 'symbol' });
  });
});
