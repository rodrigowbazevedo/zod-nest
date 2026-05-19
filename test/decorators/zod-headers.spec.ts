import 'reflect-metadata';

import { Get } from '@nestjs/common';
import { z } from 'zod';

import { ZodHeaders } from '../../src/decorators/zod-headers.decorator.js';
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
  apiParams(handler).find((p) => p.in === 'header' && p.name === name);

describe('@ZodHeaders', () => {
  it('expands each property into one @ApiHeader entry', () => {
    const registry = createRegistry();
    const schema = z
      .object({
        'x-request-id': z.string(),
        'x-trace-id': z.string().optional(),
      })
      .meta({ id: 'HeaderParams' });

    class Controller {
      @Get()
      @ZodHeaders(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'x-request-id')?.required).toBe(true);
    expect(findByName(Controller.prototype.handler, 'x-trace-id')?.required).toBe(false);
  });

  it('uses $ref for named header property schemas', () => {
    const registry = createRegistry();
    const traceIdSchema = z.string().uuid().meta({ id: 'TraceId' });
    const schema = z.object({ 'x-trace-id': traceIdSchema }).meta({ id: 'TraceHeaderParams' });

    class Controller {
      @Get()
      @ZodHeaders(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'x-trace-id')?.schema).toEqual({
      $ref: '#/components/schemas/TraceId',
    });
  });

  it('throws ZodNestError when the schema is not z.object', () => {
    const registry = createRegistry();
    expect(() => ZodHeaders(z.string(), { registry })).toThrow(
      /requires a `z.object\(\{\.\.\.\}\)` schema/,
    );
  });
});
