import { z } from 'zod';

import { createRegistry, createZodDto, defaultRegistry } from '../../src';

describe('createZodDto — registry registration', () => {
  it('registers the schema with defaultRegistry on first id resolution', () => {
    const schema = z.object({ x: z.string() });
    class Reg_Default_Dto extends createZodDto(schema, { id: 'Reg_Default' }) {}

    // Trigger lazy registration
    expect(Reg_Default_Dto.id).toBe('Reg_Default');
    expect(defaultRegistry.hasCollision('Reg_Default')).toBe(false);
    // A subsequent registration of the same schema/id is idempotent
    expect(Reg_Default_Dto.id).toBe('Reg_Default');
    expect(defaultRegistry.hasCollision('Reg_Default')).toBe(false);
  });

  it('respects options.registry when provided', () => {
    const customRegistry = createRegistry();
    const schema = z.object({ x: z.string() });
    class Reg_Custom_Dto extends createZodDto(schema, {
      id: 'Reg_Custom',
      registry: customRegistry,
    }) {}

    void Reg_Custom_Dto.id; // trigger registration

    expect(customRegistry.hasCollision('Reg_Custom')).toBe(false);
    // Default registry shouldn't have a unique 'Reg_Custom' set (only the
    // custom one tracked it).
    expect(defaultRegistry.hasCollision('Reg_Custom')).toBe(false);
  });

  it('detects collisions when two DTOs claim the same id', () => {
    const registry = createRegistry();
    const a = z.object({ a: z.string() });
    const b = z.object({ b: z.number() });
    class Reg_Coll_A_Dto extends createZodDto(a, { id: 'Reg_Collision', registry }) {}
    class Reg_Coll_B_Dto extends createZodDto(b, { id: 'Reg_Collision', registry }) {}

    void Reg_Coll_A_Dto.id;
    void Reg_Coll_B_Dto.id;

    expect(registry.hasCollision('Reg_Collision')).toBe(true);
  });
});
