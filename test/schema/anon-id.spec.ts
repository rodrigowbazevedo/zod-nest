import { z } from 'zod';

import { ANON_BODY_PREFIX, ANON_RESPONSE_PREFIX, resolveAnonId } from '../../src/schema/anon-id.js';

describe('resolveAnonId', () => {
  it('mints a prefixed id for a fresh schema', () => {
    const id = resolveAnonId(z.object({ a: z.string() }), ANON_RESPONSE_PREFIX);
    expect(id.startsWith(ANON_RESPONSE_PREFIX)).toBe(true);
  });

  it('returns the same id for the same schema instance (cache hit)', () => {
    const schema = z.object({ a: z.string() });
    const first = resolveAnonId(schema, ANON_BODY_PREFIX);
    const second = resolveAnonId(schema, ANON_BODY_PREFIX);
    expect(second).toBe(first);
  });

  it('mints distinct ids for distinct schema instances', () => {
    const first = resolveAnonId(z.object({ a: z.string() }), ANON_BODY_PREFIX);
    const second = resolveAnonId(z.object({ b: z.string() }), ANON_BODY_PREFIX);
    expect(second).not.toBe(first);
  });

  it('keeps the first prefix once a schema is cached, regardless of later prefix', () => {
    const schema = z.object({ a: z.string() });
    const first = resolveAnonId(schema, ANON_RESPONSE_PREFIX);
    const second = resolveAnonId(schema, ANON_BODY_PREFIX);
    expect(second).toBe(first);
    expect(first.startsWith(ANON_RESPONSE_PREFIX)).toBe(true);
  });
});
