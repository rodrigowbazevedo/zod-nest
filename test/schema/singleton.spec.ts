import { describe, expect, it } from 'vitest';

import { singleton } from '../../src/schema/singleton.js';

describe('singleton', () => {
  it('creates on first use and returns the same instance after', () => {
    let created = 0;
    const create = (): Map<string, number> => {
      created += 1;
      return new Map();
    };

    const first = singleton('spec-same-key', create);
    const second = singleton('spec-same-key', create);

    expect(second).toBe(first);
    expect(created).toBe(1);
  });

  it('keeps distinct keys distinct', () => {
    const a = singleton('spec-key-a', () => new Map<string, number>());
    const b = singleton('spec-key-b', () => new Map<string, number>());

    expect(b).not.toBe(a);
  });

  it('shares mutations through the returned instance', () => {
    singleton('spec-mutation', () => new Map<string, number>()).set('n', 1);

    expect(singleton('spec-mutation', () => new Map<string, number>()).get('n')).toBe(1);
  });

  // The store hangs off a `Symbol.for` key, which is what makes identity hold
  // across separate bundles of this package — the failure mode the whole
  // module exists to prevent.
  it('resolves through a Symbol.for key on globalThis', () => {
    const value = singleton('spec-global-probe', () => new Map<string, number>());
    const store: unknown = Reflect.get(globalThis, Symbol.for('zod-nest.singletons'));

    expect(store).toBeInstanceOf(Map);
    expect(store instanceof Map ? store.get('spec-global-probe') : undefined).toBe(value);
  });
});
