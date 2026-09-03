import { z } from 'zod';

import { bulkEmit } from '../../src/document/bulk-emit.js';
import { ZodNestUnrepresentableError } from '../../src/schema/errors.js';
import { createRegistry } from '../../src/schema/registry.js';

describe('bulkEmit', () => {
  it('emits one schema per registered DTO id (input + output passes)', () => {
    const registry = createRegistry();
    registry.register(z.object({ id: z.string() }), 'BulkUser_Basic');
    registry.register(z.object({ name: z.string() }), 'BulkTag_Basic');

    const { inputSchemas, outputSchemas } = bulkEmit({ registry });

    expect([...inputSchemas.keys()].sort()).toEqual(['BulkTag_Basic', 'BulkUser_Basic']);
    expect([...outputSchemas.keys()].sort()).toEqual(['BulkTag_Basic', 'BulkUser_Basic']);
  });

  it('returns empty maps when the registry has no entries', () => {
    const registry = createRegistry();
    const { inputSchemas, outputSchemas } = bulkEmit({ registry });

    expect(inputSchemas.size).toBe(0);
    expect(outputSchemas.size).toBe(0);
  });

  it('filters out ids registered in `z.globalRegistry` outside this ZodNestRegistry', () => {
    // Register `OtherSchema` directly in the global registry — not via our
    // ZodNestRegistry.register, so it doesn't appear in `registry.ids()`.
    const otherSchema = z.object({ x: z.boolean() });
    z.globalRegistry.add(otherSchema, { id: 'BulkOutsider_NotMine' });

    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), 'BulkOnlyMine');

    const { inputSchemas, outputSchemas } = bulkEmit({ registry });

    expect([...inputSchemas.keys()]).toEqual(['BulkOnlyMine']);
    expect([...outputSchemas.keys()]).toEqual(['BulkOnlyMine']);
    expect(inputSchemas.has('BulkOutsider_NotMine')).toBe(false);
  });

  it("keeps Zod's virtual `__shared` defs table out of the emitted maps", () => {
    // An anonymous cycle is extracted into `__shared` rather than a component,
    // so Zod adds that key alongside the real ids.
    const anonymousNode: z.ZodType = z.object({
      next: z.lazy(() => anonymousNode).optional(),
    });

    const registry = createRegistry();
    registry.register(z.object({ root: anonymousNode }), 'BulkShared_Root');

    const { inputSchemas, outputSchemas } = bulkEmit({ registry });

    expect([...inputSchemas.keys()]).toEqual(['BulkShared_Root']);
    expect([...outputSchemas.keys()]).toEqual(['BulkShared_Root']);
  });

  it('diverges input vs output for schemas with `.default()` (input optional / output required)', () => {
    const registry = createRegistry();
    // .default() makes a property optional on input (default fills in) but
    // required on output — a representable divergence on both sides.
    registry.register(z.object({ name: z.string().default('anon') }), 'BulkDefault_Person');

    const { inputSchemas, outputSchemas } = bulkEmit({ registry });

    const inputBody = inputSchemas.get('BulkDefault_Person');
    const outputBody = outputSchemas.get('BulkDefault_Person');
    expect(inputBody).toBeDefined();
    expect(outputBody).toBeDefined();
    expect(inputBody).not.toEqual(outputBody);
  });

  it('shapes internal `$ref`s to `#/components/schemas/<id>` via the uri callback', () => {
    const registry = createRegistry();
    const tagSchema = z.object({ name: z.string() });
    registry.register(tagSchema, 'BulkRef_Tag');
    registry.register(z.object({ tag: tagSchema }), 'BulkRef_Item');

    const { inputSchemas } = bulkEmit({ registry });
    const itemBody = inputSchemas.get('BulkRef_Item') as {
      properties?: { tag?: { $ref?: string } };
    };

    expect(itemBody.properties?.tag?.$ref).toBe('#/components/schemas/BulkRef_Tag');
  });

  it('produces independent emissions across multiple calls', () => {
    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), 'BulkIdempotent_Dto');

    const first = bulkEmit({ registry });
    const second = bulkEmit({ registry });

    expect([...first.inputSchemas.keys()]).toEqual([...second.inputSchemas.keys()]);
    expect(first.inputSchemas.get('BulkIdempotent_Dto')).toEqual(
      second.inputSchemas.get('BulkIdempotent_Dto'),
    );
  });

  describe('strict-mode unrepresentable handling', () => {
    it('throws ZodNestUnrepresentableError on strict-unrepresentable schemas', () => {
      const registry = createRegistry();
      registry.register(z.object({ s: z.symbol() }), 'BulkUnrep_Test');

      expect(() => bulkEmit({ registry })).toThrow(ZodNestUnrepresentableError);
    });

    it('honors `strict: false` (no throw on unrepresentable schemas)', () => {
      const registry = createRegistry();
      registry.register(z.object({ s: z.symbol() }), 'BulkUnrep_NonStrict');

      expect(() => bulkEmit({ registry, strict: false })).not.toThrow();
    });

    it('ignores unrepresentable globalRegistry schemas this registry never registered', () => {
      z.object({ unset: z.undefined() }).meta({ id: 'BulkUnrep_Outsider' });

      const registry = createRegistry();
      registry.register(z.object({ a: z.string() }), 'BulkUnrep_Mine');

      const { inputSchemas, outputSchemas } = bulkEmit({ registry });

      expect([...inputSchemas.keys()]).toEqual(['BulkUnrep_Mine']);
      expect([...outputSchemas.keys()]).toEqual(['BulkUnrep_Mine']);
    });
  });
});
