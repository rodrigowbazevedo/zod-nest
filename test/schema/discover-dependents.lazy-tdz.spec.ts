import { z } from 'zod';

import { discoverDependents } from '../../src/schema/discover-dependents.js';

describe('discoverDependents — z.lazy temporal dead zone', () => {
  it('yields no child instead of throwing when the getter reads an uninitialised const', () => {
    const Root: z.ZodType = z.object({ later: z.lazy(() => Later) });

    expect(discoverDependents(Root)).toEqual([]);

    const Later = z.string().meta({ id: 'TDZ_Later' });
    expect(discoverDependents(Root)).toEqual([[Later, 'TDZ_Later']]);
  });

  it('keeps walking sibling branches past a dead-zone getter', () => {
    const Named = z.string().meta({ id: 'TDZ_Sibling' });
    const Root: z.ZodType = z.object({ named: Named, later: z.lazy(() => Later) });

    expect(discoverDependents(Root)).toEqual([[Named, 'TDZ_Sibling']]);

    const Later = z.string().meta({ id: 'TDZ_SiblingLater' });
    expect(new Set(discoverDependents(Root).map(([, id]) => id))).toEqual(
      new Set(['TDZ_Sibling', 'TDZ_SiblingLater']),
    );
  });

  it('propagates a getter failure that is not a ReferenceError', () => {
    const Root = z.object({
      broken: z.lazy(() => {
        throw new TypeError('getter blew up');
      }),
    });

    expect(() => discoverDependents(Root)).toThrow(TypeError);
  });
});
