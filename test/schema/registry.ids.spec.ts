import { z } from 'zod';

import { createRegistry } from '../../src/schema/registry.js';

describe('ZodNestRegistry.ids()', () => {
  it('returns an empty list before any registration', () => {
    const registry = createRegistry();
    expect(registry.ids()).toEqual([]);
  });

  it('returns each registered id in registration order', () => {
    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), 'Alpha');
    registry.register(z.object({ b: z.number() }), 'Bravo');
    registry.register(z.object({ c: z.boolean() }), 'Charlie');

    expect(registry.ids()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('deduplicates an id used by multiple schemas (collision case)', () => {
    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), 'Dup');
    registry.register(z.object({ a: z.number() }), 'Dup');

    expect(registry.ids()).toEqual(['Dup']);
    expect(registry.hasCollision('Dup')).toBe(true);
  });

  it('returns a fresh snapshot (callers may not mutate internal state)', () => {
    const registry = createRegistry();
    registry.register(z.string(), 'One');
    const snapshot = registry.ids();
    // Mutating the snapshot must not affect subsequent calls.
    (snapshot as unknown as string[]).push('FAKE');
    expect(registry.ids()).toEqual(['One']);
  });

  it('reflects registrations added after a prior snapshot', () => {
    const registry = createRegistry();
    registry.register(z.string(), 'First');
    expect(registry.ids()).toEqual(['First']);
    registry.register(z.number(), 'Second');
    expect(registry.ids()).toEqual(['First', 'Second']);
  });
});
