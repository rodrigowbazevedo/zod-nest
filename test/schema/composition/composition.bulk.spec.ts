import { z } from 'zod';

import { bulkEmit } from '../../../src/document/bulk-emit.js';
import { extend } from '../../../src/schema/composition.js';
import { toOpenApi } from '../../../src/schema/engine.js';
import { createRegistry } from '../../../src/schema/registry.js';

describe('composition emission — single-schema and bulk parity', () => {
  it('bulk emit produces full components.schemas for Base + Child with $ref form', () => {
    const registry = createRegistry();
    const Base = z.object({ id: z.string() }).meta({ id: 'Bulk_Comp_Base' });
    const Child = extend(Base, (s) =>
      s.extend({ role: z.string() }).meta({ id: 'Bulk_Comp_Child' }),
    );
    registry.register(Base, 'Bulk_Comp_Base');
    registry.register(Child, 'Bulk_Comp_Child');

    const { inputSchemas } = bulkEmit({ registry });

    const baseBody = inputSchemas.get('Bulk_Comp_Base') as {
      type?: string;
      properties?: Record<string, unknown>;
      allOf?: unknown[];
    };
    expect(baseBody).toBeDefined();
    expect(baseBody.type).toBe('object');
    expect(baseBody.allOf).toBeUndefined();
    expect(baseBody.properties).toMatchObject({ id: { type: 'string' } });

    const childBody = inputSchemas.get('Bulk_Comp_Child') as {
      allOf?: ({ $ref?: string } | Record<string, unknown>)[];
      unevaluatedProperties?: boolean;
    };
    expect(childBody.allOf).toBeDefined();
    expect(childBody.allOf?.length).toBe(2);
    expect((childBody.allOf?.[0] as { $ref?: string }).$ref).toBe(
      '#/components/schemas/Bulk_Comp_Base',
    );
    expect(childBody.allOf?.[1]).toMatchObject({
      properties: { role: { type: 'string' } },
      required: ['role'],
    });
    expect(childBody.unevaluatedProperties).toBe(false);
  });

  it('single-schema toOpenApi(child) and bulkEmit produce equivalent child bodies', () => {
    const Base = z.object({ id: z.string() }).meta({ id: 'Bulk_Parity_Base' });
    const Child = extend(Base, (s) =>
      s.extend({ name: z.string() }).meta({ id: 'Bulk_Parity_Child' }),
    );

    const single = toOpenApi(Child, { io: 'input', registry: createRegistry() }).schema as {
      allOf?: ({ $ref?: string } | Record<string, unknown>)[];
      unevaluatedProperties?: boolean;
    };

    const bulkRegistry = createRegistry();
    bulkRegistry.register(Base, 'Bulk_Parity_Base');
    bulkRegistry.register(Child, 'Bulk_Parity_Child');
    const { inputSchemas } = bulkEmit({ registry: bulkRegistry });
    const bulk = inputSchemas.get('Bulk_Parity_Child') as {
      allOf?: ({ $ref?: string } | Record<string, unknown>)[];
      unevaluatedProperties?: boolean;
    };

    // Both modes emit the same allOf-structure for the child.
    expect((single.allOf?.[0] as { $ref?: string }).$ref).toBe(
      '#/components/schemas/Bulk_Parity_Base',
    );
    expect((bulk.allOf?.[0] as { $ref?: string }).$ref).toBe(
      '#/components/schemas/Bulk_Parity_Base',
    );
    expect(single.allOf?.[1]).toEqual(bulk.allOf?.[1]);
    expect(single.unevaluatedProperties).toBe(false);
    expect(bulk.unevaluatedProperties).toBe(false);
  });

  it('input + output io passes produce parallel composition bodies', () => {
    const Base = z.object({ id: z.string() }).meta({ id: 'Bulk_IO_Base' });
    const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Bulk_IO_Child' }));
    const registry = createRegistry();
    registry.register(Base, 'Bulk_IO_Base');
    registry.register(Child, 'Bulk_IO_Child');

    const { inputSchemas, outputSchemas } = bulkEmit({ registry });

    expect(inputSchemas.has('Bulk_IO_Child')).toBe(true);
    expect(outputSchemas.has('Bulk_IO_Child')).toBe(true);

    // Both io passes emit the allOf form for Child.
    const inChild = inputSchemas.get('Bulk_IO_Child') as { allOf?: unknown[] };
    const outChild = outputSchemas.get('Bulk_IO_Child') as { allOf?: unknown[] };
    expect(inChild.allOf).toBeDefined();
    expect(outChild.allOf).toBeDefined();
  });
});
