import 'reflect-metadata';

import { Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodBody } from '../../src/decorators/zod-body.decorator.js';
import { createRegistry } from '../../src/schema/registry.js';

const API_PARAMETERS_KEY = 'swagger/apiParameters';

interface ParamMeta {
  in: string;
  schema?: Record<string, unknown>;
  required?: boolean;
  description?: string;
}

const apiParams = (handler: object): ParamMeta[] =>
  (Reflect.getMetadata(API_PARAMETERS_KEY, handler) ?? []) as ParamMeta[];

const findBody = (handler: object): ParamMeta | undefined =>
  apiParams(handler).find((p) => p.in === 'body');

describe('@ZodBody', () => {
  it('emits a $ref body when the schema has .meta({ id })', () => {
    const registry = createRegistry();
    const schema = z
      .intersection(
        z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
        z.union([z.object({ c: z.string() }), z.object({ d: z.string() })]),
      )
      .meta({ id: 'ZodBody_RefMode' });

    class Controller {
      @Post()
      @ZodBody(schema, { registry })
      handler(): void {}
    }

    const body = findBody(Controller.prototype.handler);
    expect(body).toBeDefined();
    expect(body?.schema).toEqual({ $ref: '#/components/schemas/ZodBody_RefMode' });
    expect(body?.required).toBe(true);
    expect(registry.ids()).toContain('ZodBody_RefMode');
  });

  it('emits a synthetic anonymous $ref when the schema is anonymous (applyZodNest inlines it)', () => {
    const registry = createRegistry();
    const schema = z.intersection(
      z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
      z.union([z.object({ c: z.string() }), z.object({ d: z.string() })]),
    );

    class Controller {
      @Post()
      @ZodBody(schema, { registry })
      handler(): void {}
    }

    const body = findBody(Controller.prototype.handler);
    expect(body).toBeDefined();
    // Anonymous bodies register under a synthetic `anonymous` id and reference
    // it by $ref; `applyZodNest`'s `inlineAnonymousBodies` pass emits the body
    // (under the doc's strict/override), inlines it, and prunes the component.
    expect(body?.schema?.$ref).toMatch(/^#\/components\/schemas\/_AnonBodySchema_\d+$/);
    expect(registry.anonymousIds()).toHaveLength(1);
  });

  it('honors `id` option, overriding any .meta({ id })', () => {
    const registry = createRegistry();
    const schema = z.object({ a: z.string() }).meta({ id: 'OriginalId' });

    class Controller {
      @Post()
      @ZodBody(schema, { registry, id: 'OverrideId' })
      handler(): void {}
    }

    const body = findBody(Controller.prototype.handler);
    expect(body?.schema).toEqual({ $ref: '#/components/schemas/OverrideId' });
    expect(registry.ids()).toContain('OverrideId');
  });

  it('passes `description` through to @ApiBody', () => {
    const registry = createRegistry();
    const schema = z.object({ a: z.string() }).meta({ id: 'ZodBody_Desc' });

    class Controller {
      @Post()
      @ZodBody(schema, { registry, description: 'the body' })
      handler(): void {}
    }

    expect(findBody(Controller.prototype.handler)?.description).toBe('the body');
  });

  it('defaults `required` to true and respects an explicit false', () => {
    const registry = createRegistry();
    const schema = z.object({ a: z.string() }).meta({ id: 'ZodBody_OptionalBody' });

    class Controller {
      @Post('default')
      @ZodBody(schema, { registry })
      defaultRequired(): void {}

      @Post('explicit-false')
      @ZodBody(schema, { registry, required: false })
      explicitOptional(): void {}
    }

    expect(findBody(Controller.prototype.defaultRequired)?.required).toBe(true);
    expect(findBody(Controller.prototype.explicitOptional)?.required).toBe(false);
  });

  it('accepts non-object schemas (the whole point of this decorator)', () => {
    const registry = createRegistry();
    const schema = z.union([z.string(), z.number()]).meta({ id: 'ZodBody_UnionScalar' });

    class Controller {
      @Post()
      @ZodBody(schema, { registry })
      handler(): void {}
    }

    expect(findBody(Controller.prototype.handler)?.schema).toEqual({
      $ref: '#/components/schemas/ZodBody_UnionScalar',
    });
  });

  it('defaults to defaultRegistry when options are omitted entirely', () => {
    // No options arg at all — exercises the `options?.registry ?? defaultRegistry`
    // and `options?.id` short-circuit branches. Uses a unique id so it doesn't
    // collide with other suites also writing into defaultRegistry.
    const schema = z.object({ x: z.string() }).meta({ id: 'ZodBody_DefaultRegistry_Unique_4f1c' });

    class Controller {
      @Post()
      @ZodBody(schema)
      handler(): void {}
    }

    expect(findBody(Controller.prototype.handler)?.schema).toEqual({
      $ref: '#/components/schemas/ZodBody_DefaultRegistry_Unique_4f1c',
    });
  });

  it('registers an anonymous root and its named children so nested $refs resolve', () => {
    // The root has no id, so it's registered under a synthetic `anonymous` id
    // and referenced by $ref. Its named child has `.meta({ id })` and is
    // registered too (via descendant discovery), so the body bulk-emit writes
    // for the synthetic root keeps a resolvable $ref to the child — which
    // survives into the inlined body `applyZodNest` produces.
    const registry = createRegistry();
    const NamedChild = z.object({ value: z.string() }).meta({ id: 'ZodBody_NamedChild' });
    const anonymousRoot = z.object({ child: NamedChild });

    class Controller {
      @Post()
      @ZodBody(anonymousRoot, { registry })
      handler(): void {}
    }

    expect(registry.ids()).toContain('ZodBody_NamedChild');
    expect(registry.anonymousIds()).toHaveLength(1);
    const body = findBody(Controller.prototype.handler);
    expect(body?.schema?.$ref).toMatch(/^#\/components\/schemas\/_AnonBodySchema_\d+$/);
  });

  describe('flatten: true', () => {
    it('merges an intersection of two named object schemas into a flat inline body', () => {
      const registry = createRegistry();
      const Left = z.object({ a: z.string(), b: z.number() }).meta({ id: 'ZB_Flat_Left' });
      const Right = z.object({ c: z.boolean() }).meta({ id: 'ZB_Flat_Right' });
      const schema = z.intersection(Left, Right).meta({ id: 'ZB_Flat_Root' });

      class Controller {
        @Post()
        @ZodBody(schema, { registry, flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      expect(body?.schema?.$ref).toBeUndefined();
      expect(body?.schema?.type).toBe('object');
      const props = body?.schema?.properties as Record<string, unknown>;
      expect(Object.keys(props).sort()).toEqual(['a', 'b', 'c']);
      // Root id IS registered — the schema's natural (allOf) emission lands
      // in `components.schemas[id]` via applyZodNest's exposure rule
      // ("every registered id is exposed"). The operation body stays the
      // flat merged form for Swagger UI compatibility.
      expect(registry.ids()).toContain('ZB_Flat_Root');
    });

    it('flattens nested intersections', () => {
      const registry = createRegistry();
      const A = z.object({ a: z.string() });
      const B = z.object({ b: z.number() });
      const C = z.object({ c: z.boolean() });
      const schema = z.intersection(z.intersection(A, B), C);

      class Controller {
        @Post()
        @ZodBody(schema, { registry, flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      const props = body?.schema?.properties as Record<string, unknown>;
      expect(Object.keys(props).sort()).toEqual(['a', 'b', 'c']);
    });

    it('preserves per-property $ref for named child schemas', () => {
      const registry = createRegistry();
      const NamedChild = z.object({ v: z.string() }).meta({ id: 'ZB_Flat_NamedChild' });
      const Left = z.object({ child: NamedChild });
      const Right = z.object({ other: z.string() });
      const schema = z.intersection(Left, Right);

      class Controller {
        @Post()
        @ZodBody(schema, { registry, flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      const props = body?.schema?.properties as Record<string, { $ref?: string; type?: string }>;
      expect(props['child']?.$ref).toBe('#/components/schemas/ZB_Flat_NamedChild');
      expect(props['other']?.type).toBe('string');
      expect(registry.ids()).toContain('ZB_Flat_NamedChild');
    });

    it('resolves property collisions with last-arm-wins', () => {
      const registry = createRegistry();
      const Left = z.object({ dupe: z.string() });
      const Right = z.object({ dupe: z.number() });
      const schema = z.intersection(Left, Right);

      class Controller {
        @Post()
        @ZodBody(schema, { registry, flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      const props = body?.schema?.properties as Record<string, { type?: string }>;
      // Right arm wins: `dupe` ends up as a number.
      expect(props['dupe']?.type).toBe('number');
    });

    it('merges intersection-of-unions into a flat object with all properties optional', () => {
      // The canonical user case (taxonomy translation): two unions of objects
      // intersected. Without flatten:true this emits `allOf: [oneOf, oneOf]`
      // which Swagger UI's multipart form generator can't render. With
      // flatten:true the body is a flat object whose fields cover every
      // variant — runtime validation against the original schema still
      // enforces the precise variant shape.
      const registry = createRegistry();
      const schema = z.intersection(
        z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
        z.union([z.object({ c: z.string() }), z.object({ d: z.string() })]),
      );

      class Controller {
        @Post()
        @ZodBody(schema, { registry, flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      expect(body?.schema?.$ref).toBeUndefined();
      expect(body?.schema?.allOf).toBeUndefined();
      expect(body?.schema?.oneOf).toBeUndefined();
      expect(body?.schema?.type).toBe('object');
      const props = body?.schema?.properties as Record<string, unknown>;
      expect(Object.keys(props).sort()).toEqual(['a', 'b', 'c', 'd']);
      // Union-crossed → no property is required at the spec level.
      const required = body?.schema?.required as unknown;
      expect(required === undefined || (Array.isArray(required) && required.length === 0)).toBe(
        true,
      );
    });

    it('flattens a bare union of objects with all properties optional', () => {
      const registry = createRegistry();
      const schema = z.union([
        z.object({ alpha: z.string(), shared: z.string() }),
        z.object({ beta: z.number(), shared: z.string() }),
      ]);

      class Controller {
        @Post()
        @ZodBody(schema, { registry, flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      expect(body?.schema?.type).toBe('object');
      const props = body?.schema?.properties as Record<string, unknown>;
      expect(Object.keys(props).sort()).toEqual(['alpha', 'beta', 'shared']);
      const required = body?.schema?.required as unknown;
      expect(required === undefined || (Array.isArray(required) && required.length === 0)).toBe(
        true,
      );
    });

    it('flattens a discriminated union of objects', () => {
      const registry = createRegistry();
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), value: z.string() }),
        z.object({ kind: z.literal('b'), count: z.number() }),
      ]);

      class Controller {
        @Post()
        @ZodBody(schema, { registry, flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      expect(body?.schema?.type).toBe('object');
      const props = body?.schema?.properties as Record<string, unknown>;
      expect(Object.keys(props).sort()).toEqual(['count', 'kind', 'value']);
    });

    it('throws ZodNestError when a leaf is not a z.object', () => {
      const registry = createRegistry();
      // Primitive leaf in a union arm — not flattenable.
      const schema = z.union([z.object({ a: z.string() }), z.string()]);

      expect(() => ZodBody(schema, { registry, flatten: true })).toThrow(
        /requires every leaf of the schema to be a `z\.object\(\{\.\.\.\}\)`/,
      );
    });

    it('bare z.object: flatten emits the inline body; default defers a synthetic $ref (converged by applyZodNest)', () => {
      const registry = createRegistry();
      const schema = z.object({ q: z.string(), n: z.number() });

      class Controller {
        @Post('flat')
        @ZodBody(schema, { registry, flatten: true })
        flatHandler(): void {}

        @Post('plain')
        @ZodBody(schema, { registry })
        plainHandler(): void {}
      }

      const flat = findBody(Controller.prototype.flatHandler);
      const plain = findBody(Controller.prototype.plainHandler);
      // flatten short-circuits to the inline flat body (Swagger-UI friendly).
      expect(flat?.schema?.type).toBe('object');
      expect(Object.keys(flat?.schema?.properties as Record<string, unknown>).sort()).toEqual([
        'n',
        'q',
      ]);
      // The default path defers to a synthetic anonymous $ref; `applyZodNest`
      // inlines it back to an equivalent flat body (see the swagger-smoke
      // end-to-end suite), so the two converge in the final document.
      expect(plain?.schema?.$ref).toMatch(/^#\/components\/schemas\/_AnonBodySchema_\d+$/);
    });

    it('throws when an intersection has a non-object LEFT arm', () => {
      const registry = createRegistry();
      const schema = z.intersection(z.string(), z.object({ a: z.string() }));
      expect(() => ZodBody(schema, { registry, flatten: true })).toThrow(
        /requires every leaf of the schema to be a `z\.object\(\{\.\.\.\}\)`/,
      );
    });

    it('throws when an intersection has a non-object RIGHT arm', () => {
      const registry = createRegistry();
      const schema = z.intersection(z.object({ a: z.string() }), z.string());
      expect(() => ZodBody(schema, { registry, flatten: true })).toThrow(
        /requires every leaf of the schema to be a `z\.object\(\{\.\.\.\}\)`/,
      );
    });

    it('marks every property optional when only one arm of the intersection is union-shaped', () => {
      // Mixed shape: pure object on the left, union of objects on the right.
      // Exercises the `unionCrossed: left.unionCrossed || right.unionCrossed`
      // branch where left=false / right=true.
      const registry = createRegistry();
      const schema = z.intersection(
        z.object({ alwaysHere: z.string() }),
        z.union([z.object({ v1: z.string() }), z.object({ v2: z.number() })]),
      );

      class Controller {
        @Post()
        @ZodBody(schema, { registry, flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      const props = body?.schema?.properties as Record<string, unknown>;
      expect(Object.keys(props).sort()).toEqual(['alwaysHere', 'v1', 'v2']);
      const required = body?.schema?.required as unknown;
      // unionCrossed → all properties optional, including `alwaysHere` from
      // the non-union arm. Documented trade-off.
      expect(required === undefined || (Array.isArray(required) && required.length === 0)).toBe(
        true,
      );
    });

    it('defaults to defaultRegistry when flatten:true is set without an explicit registry', () => {
      // Exercises `options.registry ?? defaultRegistry` inside `resolveBodySchema`.
      const schema = z.intersection(z.object({ x: z.string() }), z.object({ y: z.string() }));

      class Controller {
        @Post()
        @ZodBody(schema, { flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      const props = body?.schema?.properties as Record<string, unknown>;
      expect(Object.keys(props).sort()).toEqual(['x', 'y']);
    });
  });
});
