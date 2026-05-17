import { z } from 'zod';

import { extend, getLineage } from '../../../src/schema/composition.js';

describe('composition lineage — extend + getLineage', () => {
  it('registers a LineageEntry on the derived schema', () => {
    const Base = z.object({ id: z.string() });
    const Child = extend(Base, (s) => s.extend({ role: z.string() }));

    const entry = getLineage(Child);
    expect(entry).toBeDefined();
    expect(entry?.op).toBe('extend');
    expect(entry?.parent).toBe(Base);
  });

  it('returns undefined for plain schemas with no lineage', () => {
    const plain = z.object({ x: z.string() });
    expect(getLineage(plain)).toBeUndefined();
  });

  it('does not mutate or replace the parent schema', () => {
    const Base = z.object({ id: z.string() });
    const baseShapeBefore = Object.keys(Base.shape);

    extend(Base, (s) => s.extend({ role: z.string() }));

    expect(Object.keys(Base.shape)).toEqual(baseShapeBefore);
    expect(getLineage(Base)).toBeUndefined();
  });

  it('chains: extending a derived schema records its immediate parent (not the root)', () => {
    const Base = z.object({ id: z.string() });
    const Child = extend(Base, (s) => s.extend({ role: z.string() }));
    const GrandChild = extend(Child, (s) => s.extend({ age: z.number() }));

    expect(getLineage(GrandChild)?.parent).toBe(Child);
    expect(getLineage(Child)?.parent).toBe(Base);
  });

  it('treats the build callback as the source of truth — derived schema is whatever it returns', () => {
    const Base = z.object({ id: z.string() });
    const customized = z.object({ totally: z.literal('different') });

    // A pathological build that ignores the parent — extend records lineage
    // against whatever the callback returns. Documents the contract.
    const result = extend(Base, () => customized);

    expect(result).toBe(customized);
    expect(getLineage(result)?.parent).toBe(Base);
  });

  it('TS type inference: the derived schema infers the extended shape', () => {
    const Base = z.object({ id: z.string() });
    const Child = extend(Base, (s) => s.extend({ role: z.string() }));

    // Runtime check that parsing produces both keys — proves the call site's
    // type is rich enough to allow them. The TS-level assertion is implicit
    // in the test compiling at all (`tsc --noEmit` catches inference loss).
    const parsed = Child.parse({ id: 'u1', role: 'admin' });
    expect(parsed).toEqual({ id: 'u1', role: 'admin' });
  });
});
