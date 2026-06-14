import { z } from 'zod';

import { resolveSchemaRef } from '../../src/decorators/internal/zod-schema-ref.js';
import { createRegistry } from '../../src/schema/registry.js';

const ROOT = '#/components/schemas/';

describe('resolveSchemaRef', () => {
  it('returns a $ref for a named schema (.meta({ id }))', () => {
    const registry = createRegistry();
    const schema = z.object({ a: z.string() }).meta({ id: 'SR_Named' });

    const resolution = resolveSchemaRef(schema, { registry });

    expect(resolution).toEqual({ kind: 'ref', ref: { $ref: `${ROOT}SR_Named` } });
    expect(registry.ids()).toContain('SR_Named');
  });

  it('with `deferAnonInline`, registers a synthetic anonymous id and returns a $ref', () => {
    const registry = createRegistry();
    const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]);

    const resolution = resolveSchemaRef(schema, { registry, deferAnonInline: true });

    expect(resolution.kind).toBe('ref');
    if (resolution.kind === 'ref') {
      expect(resolution.ref.$ref).toMatch(/^#\/components\/schemas\/_AnonBodySchema_\d+$/);
    }
    expect(registry.anonymousIds()).toHaveLength(1);
  });

  it('inlines an anonymous schema and registers its named descendants', () => {
    const registry = createRegistry();
    const NamedChild = z.object({ value: z.string() }).meta({ id: 'SR_NamedChild' });
    const anonymousRoot = z.object({ child: NamedChild });

    const resolution = resolveSchemaRef(anonymousRoot, { registry });

    expect(resolution.kind).toBe('inline');
    if (resolution.kind === 'inline') {
      const child = (resolution.schema.properties as Record<string, { $ref?: string }>).child;
      expect(child?.$ref).toBe(`${ROOT}SR_NamedChild`);
    }
    // The named descendant was registered (loop body) so the inline body's
    // nested $ref resolves at doc-build time.
    expect(registry.ids()).toContain('SR_NamedChild');
    expect(registry.anonymousIds()).toHaveLength(0);
  });
});
