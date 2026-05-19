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

  it('emits an inline body when the schema is anonymous', () => {
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
    expect(body?.schema?.$ref).toBeUndefined();
    expect(typeof body?.schema).toBe('object');
    expect(registry.ids()).toHaveLength(0);
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
});
