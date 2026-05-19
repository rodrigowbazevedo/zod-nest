import { z } from 'zod';

import { createRegistry, registerSchema } from '../../src/schema/registry.js';

describe('registerSchema', () => {
  it('registers under .meta({ id }) when no explicit id is provided', () => {
    const Named = z.string().meta({ id: 'RegSch_FromMeta' });
    const registry = createRegistry();

    const id = registerSchema(Named, registry);

    expect(id).toBe('RegSch_FromMeta');
    expect(registry.ids()).toEqual(['RegSch_FromMeta']);
  });

  it('registers under explicit options.id, overriding .meta({ id })', () => {
    const Named = z.string().meta({ id: 'RegSch_MetaIgnored' });
    const registry = createRegistry();

    const id = registerSchema(Named, registry, { id: 'RegSch_ExplicitWins' });

    expect(id).toBe('RegSch_ExplicitWins');
    expect(registry.ids()).toEqual(['RegSch_ExplicitWins']);
  });

  it('registers under explicit options.id when the schema has no meta', () => {
    const Anon = z.string();
    const registry = createRegistry();

    const id = registerSchema(Anon, registry, { id: 'RegSch_ExplicitOnly' });

    expect(id).toBe('RegSch_ExplicitOnly');
    expect(registry.ids()).toEqual(['RegSch_ExplicitOnly']);
  });

  it('returns undefined and is a no-op when neither explicit nor meta id is present', () => {
    const Anon = z.string();
    const registry = createRegistry();

    const id = registerSchema(Anon, registry);

    expect(id).toBeUndefined();
    expect(registry.ids()).toEqual([]);
  });

  it('treats an empty-string explicit id as missing and falls back to meta', () => {
    const Named = z.string().meta({ id: 'RegSch_EmptyExplicitFallsBack' });
    const registry = createRegistry();

    const id = registerSchema(Named, registry, { id: '' });

    expect(id).toBe('RegSch_EmptyExplicitFallsBack');
  });

  it('treats an empty-string meta id as missing and returns undefined', () => {
    const Named = z.string().meta({ id: '' });
    const registry = createRegistry();

    const id = registerSchema(Named, registry);

    expect(id).toBeUndefined();
    expect(registry.ids()).toEqual([]);
  });

  it('is idempotent — calling twice does not create a collision', () => {
    const Named = z.string().meta({ id: 'RegSch_Idem' });
    const registry = createRegistry();

    registerSchema(Named, registry);
    registerSchema(Named, registry);

    expect(registry.hasCollision('RegSch_Idem')).toBe(false);
    expect(registry.ids()).toEqual(['RegSch_Idem']);
  });

  it('walks descendants transitively (delegates to registry.register)', () => {
    const Child = z.literal('c').meta({ id: 'RegSch_Trans_Child' });
    const Parent = z.object({ child: Child }).meta({ id: 'RegSch_Trans_Parent' });
    const registry = createRegistry();

    registerSchema(Parent, registry);

    expect(new Set(registry.ids())).toEqual(new Set(['RegSch_Trans_Parent', 'RegSch_Trans_Child']));
  });

  it('uses defaultRegistry when no registry argument is passed', () => {
    // Unique id avoids collision with other tests writing to defaultRegistry.
    const Named = z.string().meta({ id: 'RegSch_DefaultRegistry_OptIn' });

    const id = registerSchema(Named);

    expect(id).toBe('RegSch_DefaultRegistry_OptIn');
    // Don't assert against `defaultRegistry.ids()` membership shape — other
    // suites pollute it. The non-undefined return is the contract.
  });
});
