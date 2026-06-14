import { z } from 'zod';

import type { RegisterFlags } from '../../src';

import { createRegistry } from '../../src/schema/registry.js';

describe('registry — RegisterFlags (expose / anonymous)', () => {
  it('tracks { expose: true } ids in forceExposedIds()', () => {
    const registry = createRegistry();
    const flags: RegisterFlags = { expose: true };
    registry.register(z.object({ a: z.string() }), 'Forced', flags);
    registry.register(z.object({ b: z.string() }), 'Plain');
    expect(registry.forceExposedIds()).toEqual(['Forced']);
    expect(registry.anonymousIds()).toEqual([]);
  });

  it('tracks { anonymous: true } ids in anonymousIds()', () => {
    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), '_AnonResponseSchema_1', { anonymous: true });
    expect(registry.anonymousIds()).toEqual(['_AnonResponseSchema_1']);
    expect(registry.forceExposedIds()).toEqual([]);
  });

  it('flags are sticky — a later plain re-register does not clear them', () => {
    const registry = createRegistry();
    const schema = z.object({ a: z.string() });
    registry.register(schema, 'Sticky', { expose: true, anonymous: true });
    registry.register(schema, 'Sticky');
    expect(registry.forceExposedIds()).toEqual(['Sticky']);
    expect(registry.anonymousIds()).toEqual(['Sticky']);
  });

  it('omitting flags leaves both sets empty', () => {
    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), 'Bare');
    expect(registry.forceExposedIds()).toEqual([]);
    expect(registry.anonymousIds()).toEqual([]);
  });
});
