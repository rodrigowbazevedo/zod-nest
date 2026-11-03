import { z } from 'zod';

import type { ZodNestRegistry } from '../../src/schema/registry.js';

import { createRegistry, registryRevision } from '../../src/schema/registry.js';

describe('registryRevision', () => {
  it('starts at zero for a fresh registry', () => {
    expect(registryRevision(createRegistry())).toBe(0);
  });

  it('advances when a new schema is registered', () => {
    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), 'Revision_First');
    const afterFirst = registryRevision(registry);

    registry.register(z.object({ b: z.string() }), 'Revision_Second');

    expect(afterFirst).toBeGreaterThan(0);
    expect(registryRevision(registry)).toBeGreaterThan(afterFirst ?? 0);
  });

  it('stays put on an idempotent re-register', () => {
    const registry = createRegistry();
    const schema = z.object({ a: z.string() });
    registry.register(schema, 'Revision_Idempotent');
    const before = registryRevision(registry);

    registry.register(schema, 'Revision_Idempotent');

    expect(registryRevision(registry)).toBe(before);
  });

  it.each([
    ['expose', { expose: true }],
    ['anonymous', { anonymous: true }],
  ])('advances when a re-register adds the `%s` flag', (_label, flags) => {
    const registry = createRegistry();
    const schema = z.object({ a: z.string() });
    registry.register(schema, 'Revision_Flags');
    const before = registryRevision(registry);

    registry.register(schema, 'Revision_Flags', flags);

    expect(registryRevision(registry)).toBeGreaterThan(before ?? 0);
  });

  it('is undefined for a registry zod-nest did not create', () => {
    const base = createRegistry();
    const foreign: ZodNestRegistry = { ...base };

    expect(registryRevision(foreign)).toBeUndefined();
  });
});
