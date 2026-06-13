import 'reflect-metadata';

import { Get } from '@nestjs/common';
import { z } from 'zod';

import { ZodQuery } from '../../src/decorators/zod-query.decorator.js';
import { ZodNestError } from '../../src/schema/errors.js';
import { createRegistry } from '../../src/schema/registry.js';

const API_PARAMETERS_KEY = 'swagger/apiParameters';

interface ParamMeta extends Record<string, unknown> {
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
  // ─── Named schemas defer to the marker pass (expandParamMarkers) ─────────

  it('emits a single deferred query marker for a named schema (no per-property expansion at decoration time)', () => {
    const registry = createRegistry();
    const schema = z
      .object({ q: z.string(), limit: z.number().optional() })
      .meta({ id: 'QueryParams' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    const params = apiParams(Controller.prototype.handler);
    expect(params).toEqual([
      { name: 'QueryParams', in: 'query', __zodNestDto: true, dtoId: 'QueryParams', io: 'input' },
    ]);
  });

  it('registers the named root schema so it lands in components.schemas', () => {
    const registry = createRegistry();
    const schema = z.object({ q: z.string() }).meta({ id: 'RegisteredQuery' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    expect(apiParams(Controller.prototype.handler)).toHaveLength(1);
    expect(registry.ids()).toContain('RegisteredQuery');
  });

  it('uses the explicit `id` option as the marker dtoId', () => {
    const registry = createRegistry();
    const schema = z.object({ q: z.string() });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry, id: 'ForcedId' })
      handler(): void {}
    }

    const [marker] = apiParams(Controller.prototype.handler);
    expect(marker?.dtoId).toBe('ForcedId');
    expect(marker?.__zodNestDto).toBe(true);
  });

  it('carries `ref: true` on the marker when requested', () => {
    const registry = createRegistry();
    const schema = z.object({ q: z.string() }).meta({ id: 'RefTrueQuery' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry, ref: true })
      handler(): void {}
    }

    const [marker] = apiParams(Controller.prototype.handler);
    expect(marker?.ref).toBe(true);
  });

  it('carries `ref: false` on the marker when forced to expand', () => {
    const registry = createRegistry();
    const schema = z.object({ q: z.string() }).meta({ id: 'RefFalseQuery' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry, ref: false })
      handler(): void {}
    }

    const [marker] = apiParams(Controller.prototype.handler);
    expect(marker?.ref).toBe(false);
  });

  it('omits `ref` from the marker when unset (follows the global preference)', () => {
    const registry = createRegistry();
    const schema = z.object({ q: z.string() }).meta({ id: 'NoRefQuery' });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    const [marker] = apiParams(Controller.prototype.handler);
    expect(marker).not.toHaveProperty('ref');
  });

  // ─── Anonymous schemas expand per-property at decoration time ────────────

  it('expands each property into one @ApiQuery entry for an anonymous schema', () => {
    const registry = createRegistry();
    const schema = z.object({ q: z.string(), limit: z.number().optional() });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'q')?.required).toBe(true);
    expect(findByName(Controller.prototype.handler, 'limit')?.required).toBe(false);
    expect(apiParams(Controller.prototype.handler).some((p) => p.__zodNestDto === true)).toBe(
      false,
    );
  });

  it('uses $ref for named property schemas of an anonymous root', () => {
    const registry = createRegistry();
    const statusSchema = z.enum(['open', 'closed']).meta({ id: 'Status' });
    const schema = z.object({ status: statusSchema });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'status')?.schema).toEqual({
      $ref: '#/components/schemas/Status',
    });
    expect(registry.ids()).toContain('Status');
  });

  it('treats default-wrapped properties as optional (anonymous root)', () => {
    const registry = createRegistry();
    const schema = z.object({ limit: z.number().default(10) });

    class Controller {
      @Get()
      @ZodQuery(schema, { registry })
      handler(): void {}
    }

    expect(findByName(Controller.prototype.handler, 'limit')?.required).toBe(false);
  });

  // ─── Guards ──────────────────────────────────────────────────────────────

  it('throws ZodNestError when the schema is not z.object', () => {
    const registry = createRegistry();
    expect(() => ZodQuery(z.string(), { registry })).toThrow(
      /requires a `z.object\(\{\.\.\.\}\)` schema/,
    );
  });

  it('throws ZodNestError for `ref: true` on an anonymous schema (no component to $ref)', () => {
    const registry = createRegistry();
    expect(() => ZodQuery(z.object({ q: z.string() }), { registry, ref: true })).toThrow(
      ZodNestError,
    );
    expect(() => ZodQuery(z.object({ q: z.string() }), { registry, ref: true })).toThrow(
      /requires a named schema/,
    );
  });
});
