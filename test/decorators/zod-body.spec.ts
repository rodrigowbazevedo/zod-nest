import 'reflect-metadata';

import { Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodBody } from '../../src/decorators/zod-body.decorator.js';
import { createRegistry, defaultRegistry } from '../../src/schema/registry.js';

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
    it('defers the merged body as a synthetic anonymous $ref', () => {
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
      expect(body?.schema?.$ref).toMatch(/^#\/components\/schemas\/_AnonBodySchema_\d+$/);
      expect(registry.anonymousIds()).toHaveLength(1);
      // The root id is registered too, so its natural (allOf) emission lands
      // in `components.schemas` alongside the flat merged operation body.
      expect(registry.ids()).toContain('ZB_Flat_Root');
    });

    it('does not emit at decoration time, so applyZodNest options reach the body', () => {
      const registry = createRegistry();
      // `z.symbol()` is strict-unrepresentable. Eager emission threw right
      // here, before `applyZodNest`'s `strict` / `override` was ever consulted.
      const schema = z.intersection(z.object({ sym: z.symbol() }), z.object({ who: z.string() }));

      expect(() => {
        class Controller {
          @Post()
          @ZodBody(schema, { registry, flatten: true })
          handler(): void {}
        }
        return Controller;
      }).not.toThrow();
      expect(registry.anonymousIds()).toHaveLength(1);
    });

    it('throws ZodNestError when a leaf is not a z.object', () => {
      const registry = createRegistry();
      // Primitive leaf in a union arm — not flattenable.
      const schema = z.union([z.object({ a: z.string() }), z.string()]);

      expect(() => ZodBody(schema, { registry, flatten: true })).toThrow(
        /requires every leaf of the schema to be a `z\.object\(\{\.\.\.\}\)`/,
      );
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

    it('defaults to defaultRegistry when flatten:true is set without an explicit registry', () => {
      // Exercises `options.registry ?? defaultRegistry` inside `resolveBodySchema`.
      const schema = z.intersection(z.object({ x: z.string() }), z.object({ y: z.string() }));

      class Controller {
        @Post()
        @ZodBody(schema, { flatten: true })
        handler(): void {}
      }

      const body = findBody(Controller.prototype.handler);
      const ref = body?.schema?.$ref;
      expect(ref).toMatch(/^#\/components\/schemas\/_AnonBodySchema_\d+$/);
      expect(defaultRegistry.anonymousIds()).toContain(
        String(ref).slice('#/components/schemas/'.length),
      );
    });
  });
});
