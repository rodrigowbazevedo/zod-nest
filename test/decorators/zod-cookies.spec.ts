import 'reflect-metadata';

import { Get } from '@nestjs/common';
import { z } from 'zod';

import { ZodCookies } from '../../src/decorators/zod-cookies.decorator.js';
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
  apiParams(handler).find((p) => p.in === 'cookie' && p.name === name);

describe('@ZodCookies', () => {
  it('expands each property into one cookie-parameter entry', () => {
    const registry = createRegistry();
    const schema = z
      .object({ sessionId: z.string(), theme: z.string().optional() })
      .meta({ id: 'CookieParams' });

    class Controller {
      @Get()
      @ZodCookies(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'sessionId')?.required).toBe(true);
    expect(findByName(Controller.prototype.handler, 'theme')?.required).toBe(false);
    expect(findByName(Controller.prototype.handler, 'sessionId')?.schema).toEqual({
      type: 'string',
    });
  });

  it('uses $ref for named cookie property schemas', () => {
    const registry = createRegistry();
    const sidSchema = z.string().min(16).meta({ id: 'SessionId' });
    const schema = z.object({ sessionId: sidSchema }).meta({ id: 'SidCookies' });

    class Controller {
      @Get()
      @ZodCookies(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'sessionId')?.schema).toEqual({
      $ref: '#/components/schemas/SessionId',
    });
  });

  it('appends to an existing parameters list rather than overwriting', () => {
    const registry = createRegistry();
    const handler = function existingMethod(): void {};
    Reflect.defineMetadata(API_PARAMETERS_KEY, [{ name: 'pre-existing', in: 'query' }], handler);
    const decorator = ZodCookies(z.object({ sid: z.string() }).meta({ id: 'AppendCookies' }), {
      registry,
    });
    decorator({}, 'foo', { value: handler });

    const params = apiParams(handler);
    expect(params).toHaveLength(2);
    expect(params[0]?.name).toBe('pre-existing');
    expect(params[1]?.name).toBe('sid');
    expect(params[1]?.in).toBe('cookie');
  });

  it('throws ZodNestError when the schema is not z.object', () => {
    const registry = createRegistry();
    expect(() => ZodCookies(z.string(), { registry })).toThrow(
      /requires a `z.object\(\{\.\.\.\}\)` schema/,
    );
  });

  it('throws TypeError when applied to something other than a method', () => {
    const registry = createRegistry();
    const decorator = ZodCookies(z.object({ sid: z.string() }).meta({ id: 'GuardCookies' }), {
      registry,
    });
    expect(() => decorator({}, 'x', { value: undefined })).toThrow(
      /@ZodCookies can only be applied to methods/,
    );
  });
});
