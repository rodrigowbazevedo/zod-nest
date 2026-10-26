import { z } from 'zod';

import { isCompileActive, safeParseWithMode } from '../../src/schema/parse.js';

const asyncEmail = () =>
  z.object({
    email: z.string().refine(async (v) => v.endsWith('@example.com'), 'must be @example.com'),
  });

describe('safeParseWithMode', () => {
  it("parses with safeParseAsync under 'async'", async () => {
    const schema = z.object({ id: z.string() });
    const syncSpy = vi.spyOn(schema, 'safeParse');
    const asyncSpy = vi.spyOn(schema, 'safeParseAsync');

    const result = await safeParseWithMode(schema, { id: 'a' }, 'async');

    expect(result).toEqual({ success: true, data: { id: 'a' } });
    expect(syncSpy).not.toHaveBeenCalled();
    expect(asyncSpy).toHaveBeenCalledOnce();
  });

  it("parses with safeParseAsync under 'auto' when compile is not active", async () => {
    const schema = z.object({ id: z.string() });
    const syncSpy = vi.spyOn(schema, 'safeParse');

    expect(isCompileActive(schema)).toBe(false);
    await safeParseWithMode(schema, { id: 'a' }, 'auto');

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it("parses with safeParse under 'sync-first'", async () => {
    const schema = z.object({ id: z.string() });
    const syncSpy = vi.spyOn(schema, 'safeParse');
    const asyncSpy = vi.spyOn(schema, 'safeParseAsync');

    const result = await safeParseWithMode(schema, { id: 1 }, 'sync-first');

    expect(result.success).toBe(false);
    expect(syncSpy).toHaveBeenCalledOnce();
    expect(asyncSpy).not.toHaveBeenCalled();
  });

  it('falls back to safeParseAsync for an async refinement, with the same issues', async () => {
    const schema = asyncEmail();
    const input = { email: 'me@elsewhere.com' };

    const result = await safeParseWithMode(schema, input, 'sync-first');
    const expected = await schema.safeParseAsync(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(expected.error?.issues);
  });

  it('skips the sync attempt once a schema is known to be async', async () => {
    const schema = asyncEmail();
    const syncSpy = vi.spyOn(schema, 'safeParse');

    await safeParseWithMode(schema, { email: 'a@example.com' }, 'sync-first');
    await safeParseWithMode(schema, { email: 'b@example.com' }, 'sync-first');

    expect(syncSpy).toHaveBeenCalledOnce();
  });

  it('rethrows errors other than $ZodAsyncError', async () => {
    const schema = z.string().transform(() => {
      throw new Error('boom');
    });

    await expect(safeParseWithMode(schema, 'x', 'sync-first')).rejects.toThrow('boom');
  });
});
