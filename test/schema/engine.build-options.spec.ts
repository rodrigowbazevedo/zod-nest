import { z } from 'zod';

import { buildToJsonSchemaOptions } from '../../src/schema/engine.js';
import { createRegistry } from '../../src/schema/registry.js';

describe('buildToJsonSchemaOptions', () => {
  it('returns the shared option bag (no uri unless requested)', () => {
    const registry = createRegistry();
    const built = buildToJsonSchemaOptions({
      registry,
      io: 'input',
      reused: 'inline',
    });

    expect(built.options).toMatchObject({
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
      metadata: registry.zodRegistry,
      cycles: 'ref',
      reused: 'inline',
    });
    expect(built.options.uri).toBeUndefined();
  });

  it('sets `uri` when provided (bulk-mode signature)', () => {
    const registry = createRegistry();
    const uri = (id: string): string => `#/components/schemas/${id}`;
    const built = buildToJsonSchemaOptions({
      registry,
      io: 'output',
      reused: 'ref',
      uri,
    });

    expect(built.options.uri).toBe(uri);
    expect(built.options.reused).toBe('ref');
  });

  it('consumeUnrepresentable() is a no-op when no strict-unrepresentable hit fired', () => {
    const registry = createRegistry();
    const built = buildToJsonSchemaOptions({ registry, io: 'input', reused: 'inline' });
    expect(() => built.consumeUnrepresentable()).not.toThrow();
  });

  it('threads io+metadata into the option bag so single + bulk emit equivalently', () => {
    const registry = createRegistry();
    const builtIn = buildToJsonSchemaOptions({ registry, io: 'input', reused: 'inline' });
    const builtOut = buildToJsonSchemaOptions({ registry, io: 'output', reused: 'ref' });

    expect(builtIn.options.io).toBe('input');
    expect(builtOut.options.io).toBe('output');
    // Same registry → same metadata reference → both passes see the same id index.
    expect(builtIn.options.metadata).toBe(builtOut.options.metadata);
    expect(builtIn.options.metadata).toBe(z.globalRegistry);
  });
});
