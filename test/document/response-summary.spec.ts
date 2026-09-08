import 'reflect-metadata';

import { Controller, Get, HttpCode, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';
import { applyResponseSummary } from '../../src/document/response-summary.js';
import { validateOpenApi } from './openapi-validator.js';

const docWith = (pathItem: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.2.0',
    info: { title: 't', version: 'v' },
    paths: { '/things': pathItem },
  }) as unknown as OpenAPIObject;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const responseAt = (doc: OpenAPIObject, status: string): Record<string, unknown> => {
  const paths: Record<string, unknown> = doc.paths;
  const pathItem = paths['/things'];
  if (!isRecord(pathItem) || !isRecord(pathItem.get) || !isRecord(pathItem.get.responses)) {
    throw new Error('fixture has no /things GET responses');
  }
  const response = pathItem.get.responses[status];
  if (!isRecord(response)) {
    throw new Error(`fixture has no ${status} response`);
  }
  return response;
};

describe('applyResponseSummary — `emit: true` (3.2 targets)', () => {
  it('leaves `summary` in place', () => {
    const doc = docWith({
      get: { responses: { 200: { description: 'ok', summary: 'the thing' } } },
    });

    applyResponseSummary(doc, { emit: true });

    expect(responseAt(doc, '200')).toEqual({ description: 'ok', summary: 'the thing' });
  });
});

describe('applyResponseSummary — `emit: false` (3.1 targets)', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('strips `summary` and leaves the rest of the response untouched', () => {
    const doc = docWith({
      get: { responses: { 200: { description: 'ok', summary: 'the thing', headers: {} } } },
    });

    applyResponseSummary(doc, { emit: false });

    expect(responseAt(doc, '200')).toEqual({ description: 'ok', headers: {} });
  });

  it('warns once per affected response, naming method, path and status', () => {
    const doc = docWith({
      get: {
        responses: {
          200: { description: 'ok', summary: 'found' },
          404: { description: 'gone', summary: 'missing' },
        },
      },
    });

    applyResponseSummary(doc, { emit: false });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain(
      'Dropped `summary` from `GET /things` response `200`',
    );
    expect(warn.mock.calls[0]?.[0]).toContain("setOpenAPIVersion('3.2.0')");
    expect(warn.mock.calls[1]?.[0]).toContain(
      'Dropped `summary` from `GET /things` response `404`',
    );
  });

  it('covers operations relocated under `additionalOperations`', () => {
    const doc = docWith({
      additionalOperations: { SEARCH: { responses: { 200: { description: 'ok', summary: 's' } } } },
    });

    applyResponseSummary(doc, { emit: false });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('`SEARCH /things` response `200`');
  });

  it('stays silent when no response carries a `summary`', () => {
    const doc = docWith({ get: { responses: { 200: { description: 'ok' } } } });

    applyResponseSummary(doc, { emit: false });

    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent for an explicitly `undefined` summary, which never emits', () => {
    const doc = docWith({ get: { responses: { 200: { description: 'ok', summary: undefined } } } });

    applyResponseSummary(doc, { emit: false });

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('applyResponseSummary — malformed documents', () => {
  it.each([
    ['a path set that is not an object', { openapi: '3.1.0', paths: 'nope' }],
    ['a path item that is not an object', { openapi: '3.1.0', paths: { '/x': 'nope' } }],
    ['an operation that is not an object', { openapi: '3.1.0', paths: { '/x': { get: 7 } } }],
    [
      'a response set that is not an object',
      { openapi: '3.1.0', paths: { '/x': { get: { responses: 'nope' } } } },
    ],
    [
      'a response that is not an object',
      { openapi: '3.1.0', paths: { '/x': { get: { responses: { 200: 'nope' } } } } },
    ],
    [
      'a `$ref`-only response',
      { openapi: '3.1.0', paths: { '/x': { get: { responses: { 200: { $ref: '#/x' } } } } } },
    ],
    [
      'an `additionalOperations` entry that is not an object',
      { openapi: '3.1.0', paths: { '/x': { additionalOperations: { SEARCH: 7 } } } },
    ],
  ])('walks past %s without throwing', (_label, doc) => {
    expect(() =>
      applyResponseSummary(doc as unknown as OpenAPIObject, { emit: false }),
    ).not.toThrow();
  });
});

class ThingDto extends createZodDto(z.object({ id: z.string() }), { id: 'Thing' }) {}

@Controller('things')
class SummaryController {
  @Get('one')
  @ZodResponse({ type: ThingDto, description: { description: 'the thing', summary: 'One thing' } })
  one(): ThingDto {
    return { id: 'a' };
  }

  @Get('rich')
  @HttpCode(200)
  @ZodResponse({
    type: ThingDto,
    description: {
      description: 'with siblings',
      summary: 'Rich thing',
      headers: { 'X-Rate-Limit': { schema: { type: 'integer' } } },
      links: { GetThing: { operationId: 'getThing' } },
    },
  })
  rich(): ThingDto {
    return { id: 'b' };
  }

  @Get('plain')
  @ZodResponse({ type: ThingDto, description: 'string form' })
  plain(): ThingDto {
    return { id: 'c' };
  }
}

const bootstrap = async (controller: Type<unknown>, declared: string): Promise<OpenAPIObject> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers: [controller],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const builder = new DocumentBuilder().setTitle('t').setVersion('v').setOpenAPIVersion(declared);
  const raw = SwaggerModule.createDocument(app, builder.build());
  await app.close();
  return applyZodNest(raw);
};

const responseOf = (doc: OpenAPIObject, path: string): Record<string, unknown> => {
  const response: unknown = doc.paths[path]?.get?.responses?.['200'];
  if (!isRecord(response)) {
    throw new Error(`document has no 200 response for ${path}`);
  }
  return response;
};

describe('@ZodResponse — `summary` end to end', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('emits `summary` under 3.2, alongside `description`', async () => {
    const doc = await bootstrap(SummaryController, '3.2.0');

    expect(responseOf(doc, '/things/one')).toMatchObject({
      description: 'the thing',
      summary: 'One thing',
    });
    expect(warn).not.toHaveBeenCalled();
    expect(() => validateOpenApi(doc)).not.toThrow();
  });

  it('carries `summary` beside `headers` and `links`', async () => {
    const doc = await bootstrap(SummaryController, '3.2.0');

    expect(responseOf(doc, '/things/rich')).toMatchObject({
      description: 'with siblings',
      summary: 'Rich thing',
      headers: { 'X-Rate-Limit': { schema: { type: 'integer' } } },
      links: { GetThing: { operationId: 'getThing' } },
    });
  });

  // The field really is 3.2-only: the same body fails against the 3.1 schema.
  it('produces a body that 3.1 rejects, proving the gate is needed', async () => {
    const doc = await bootstrap(SummaryController, '3.2.0');

    expect(() => validateOpenApi({ ...doc, openapi: '3.1.0' })).toThrow(/unevaluated properties/);
  });

  it('drops `summary` under 3.1 and warns per affected response', async () => {
    const doc = await bootstrap(SummaryController, '3.1.0');

    expect(responseOf(doc, '/things/one')).not.toHaveProperty('summary');
    expect(responseOf(doc, '/things/rich')).not.toHaveProperty('summary');
    expect(responseOf(doc, '/things/one').description).toBe('the thing');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(() => validateOpenApi(doc)).not.toThrow();
  });

  it('leaves the string form of `description` untouched under either version', async () => {
    const asThirtyTwo = await bootstrap(SummaryController, '3.2.0');
    const asThirtyOne = await bootstrap(SummaryController, '3.1.0');

    expect(responseOf(asThirtyTwo, '/things/plain')).toMatchObject({ description: 'string form' });
    expect(responseOf(asThirtyTwo, '/things/plain')).not.toHaveProperty('summary');
    expect(responseOf(asThirtyOne, '/things/plain')).toMatchObject({ description: 'string form' });
  });
});
