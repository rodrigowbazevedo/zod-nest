import { z } from 'zod';

import { bulkEmit } from '../../../src/document/bulk-emit.js';
import { extend } from '../../../src/schema/composition.js';
import { createRegistry } from '../../../src/schema/registry.js';

describe('composition snapshot — Base → Child → GrandChild chain', () => {
  it('bulkEmit produces the hand-rolled OpenAPI 3.1 schemas for the 3-level chain', () => {
    const Base = z.object({ id: z.string(), name: z.string() }).meta({ id: 'Snap_Base' });
    const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Snap_Child' }));
    const GrandChild = extend(Child, (s) =>
      s.extend({ age: z.number() }).meta({ id: 'Snap_GrandChild' }),
    );

    const registry = createRegistry();
    registry.register(Base, 'Snap_Base');
    registry.register(Child, 'Snap_Child');
    registry.register(GrandChild, 'Snap_GrandChild');

    const { inputSchemas } = bulkEmit({ registry });

    expect(inputSchemas.get('Snap_Base')).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: '#/components/schemas/Snap_Base',
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['id', 'name'],
    });

    expect(inputSchemas.get('Snap_Child')).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: '#/components/schemas/Snap_Child',
      allOf: [
        { $ref: '#/components/schemas/Snap_Base' },
        {
          type: 'object',
          properties: { role: { type: 'string' } },
          required: ['role'],
        },
      ],
      unevaluatedProperties: false,
    });

    expect(inputSchemas.get('Snap_GrandChild')).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: '#/components/schemas/Snap_GrandChild',
      allOf: [
        { $ref: '#/components/schemas/Snap_Child' },
        {
          type: 'object',
          properties: { age: { type: 'number' } },
          required: ['age'],
        },
      ],
      unevaluatedProperties: false,
    });
  });
});
