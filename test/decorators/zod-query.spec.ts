import 'reflect-metadata';

import { Get } from '@nestjs/common';
import { z } from 'zod';

import { ZodQuery } from '../../src/decorators/zod-query.decorator.js';
import { createRegistry } from '../../src/schema/registry.js';

const API_PARAMETERS_KEY = 'swagger/apiParameters';

interface ParamMeta {
  name: string;
  in: string;
  schema?: Record<string, unknown>;
  required?: boolean;
}

const apiParams = (handler: object): ParamMeta[] =>
  (Reflect.getMetadata(API_PARAMETERS_KEY, handler) ?? []) as ParamMeta[];

const findByName = (handler: object, name: string): ParamMeta | undefined =>
  apiParams(handler).find((p) => p.in === 'query' && p.name === name);

describe('@ZodQuery', () => {
  it('expands each property into one @ApiQuery entry', () => {
    const registry = createRegistry();
    const schema = z
      .object({ q: z.string(), limit: z.number().optional() })
      .meta({ id: 'QueryParams' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'q')).toBeDefined();
    expect(findByName(Controller.prototype.handler, 'limit')).toBeDefined();
    expect(findByName(Controller.prototype.handler, 'q')?.required).toBe(true);
    expect(findByName(Controller.prototype.handler, 'limit')?.required).toBe(false);
  });

  it('uses $ref for property schemas that are named via .meta({ id })', () => {
    const registry = createRegistry();
    const statusSchema = z.enum(['open', 'closed']).meta({ id: 'Status' });
    const schema = z.object({ status: statusSchema }).meta({ id: 'StatusQuery' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'status')?.schema).toEqual({
      $ref: '#/components/schemas/Status',
    });
    expect(registry.ids()).toEqual(expect.arrayContaining(['StatusQuery', 'Status']));
  });

  it('inlines anonymous property schemas', () => {
    const registry = createRegistry();
    const schema = z.object({ q: z.string() }).meta({ id: 'AnonProp' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    const param = findByName(Controller.prototype.handler, 'q');
    expect(param?.schema).toEqual({ type: 'string' });
  });

  it('treats default-wrapped properties as optional', () => {
    const registry = createRegistry();
    const schema = z.object({ limit: z.number().default(10) }).meta({ id: 'DefaultPropQuery' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'limit')?.required).toBe(false);
  });

  it('throws ZodNestError when the schema is not z.object', () => {
    const registry = createRegistry();
    expect(() => ZodQuery(z.string(), { registry })).toThrow(
      /requires a `z.object\(\{\.\.\.\}\)` schema/,
    );
  });
});
