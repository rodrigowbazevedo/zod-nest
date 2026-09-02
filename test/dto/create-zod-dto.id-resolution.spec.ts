import { z } from 'zod';

import { createZodDto } from '../../src';
import { singleton } from '../../src/schema/singleton.js';

// The warn-once flag is process-wide, so it survives across spec files. Reset
// it here rather than depending on this being the first file to mint an
// anonymous id.
const anonState = singleton('anon-dto-state', () => ({ counter: 0, warned: false }));

describe('createZodDto — id resolution', () => {
  beforeEach(() => {
    anonState.warned = false;
  });

  it('uses options.id when provided', () => {
    const schema = z.object({ x: z.string() });
    class IdRes_OptionId_Dto extends createZodDto(schema, { id: 'IdRes_OptionId_Explicit' }) {}
    expect(IdRes_OptionId_Dto.id).toBe('IdRes_OptionId_Explicit');
  });

  it('falls back to schema.meta({ id }) when no options.id', () => {
    const schema = z.object({ x: z.string() }).meta({ id: 'IdRes_MetaId' });
    class IdRes_MetaId_Dto extends createZodDto(schema) {}
    expect(IdRes_MetaId_Dto.id).toBe('IdRes_MetaId');
  });

  it('uses class name when no options.id and no meta.id', () => {
    const schema = z.object({ x: z.string() });
    class IdRes_ClassName_Dto extends createZodDto(schema) {}
    expect(IdRes_ClassName_Dto.id).toBe('IdRes_ClassName_Dto');
  });

  it('options.id wins over schema.meta.id', () => {
    const schema = z.object({ x: z.string() }).meta({ id: 'IdRes_LosingMeta' });
    class IdRes_Override_Dto extends createZodDto(schema, { id: 'IdRes_OverrideWins' }) {}
    expect(IdRes_Override_Dto.id).toBe('IdRes_OverrideWins');
  });

  it('warns once per process, not once per anonymous DTO', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = createZodDto(z.object({ a: z.string() }));
    Object.defineProperty(first, 'name', { value: 'a', configurable: true });
    const second = createZodDto(z.object({ b: z.string() }));
    Object.defineProperty(second, 'name', { value: 'b', configurable: true });

    expect(first.id).toMatch(/^_AnonZodDto_\d+$/);
    expect(second.id).toMatch(/^_AnonZodDto_\d+$/);
    // The counter is shared, so the two fall back to distinct ids.
    expect(first.id).not.toBe(second.id);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it('falls back to _AnonZodDto_N with warning when class name is single-char (mangled)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const schema = z.object({ x: z.string() });
    // simulate minified class name: rename via Object.defineProperty
    const Anon = createZodDto(schema);
    Object.defineProperty(Anon, 'name', { value: 't', configurable: true });

    expect(Anon.id).toMatch(/^_AnonZodDto_\d+$/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('zod-nest');

    warn.mockRestore();
  });
});
