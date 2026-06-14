import 'reflect-metadata';

import { Controller, Get, HttpStatus } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';
import { applyRefTitles } from '../../src/document/ref-titles.js';

const ROOT = '#/components/schemas/';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/** Walk a nested doc by key path, returning `undefined` on any miss. */
const at = (root: unknown, ...path: string[]): unknown => {
  let cursor: unknown = root;
  for (const key of path) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[key];
  }
  return cursor;
};

const makeDoc = (override: { paths?: unknown; components?: unknown }): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: {},
    components: { schemas: {} },
    ...override,
  }) as unknown as OpenAPIObject;

describe('applyRefTitles', () => {
  it('copies a titled component’s title onto refs that target it (paths + nested bodies)', () => {
    const doc = makeDoc({
      paths: {
        '/x': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: `${ROOT}Foo` } } } },
            },
          },
        },
      },
      components: {
        schemas: {
          Foo: { type: 'object', title: 'Foo', properties: { x: { type: 'string' } } },
          Wrapper: {
            type: 'object',
            properties: {
              foo: { $ref: `${ROOT}Foo` },
              list: { type: 'array', items: { $ref: `${ROOT}Foo` } },
            },
          },
        },
      },
    });

    applyRefTitles(doc);

    expect(
      at(doc, 'paths', '/x', 'get', 'responses', '200', 'content', 'application/json', 'schema'),
    ).toEqual({ $ref: `${ROOT}Foo`, title: 'Foo' });
    expect(at(doc, 'components', 'schemas', 'Wrapper', 'properties', 'foo')).toEqual({
      $ref: `${ROOT}Foo`,
      title: 'Foo',
    });
    expect(at(doc, 'components', 'schemas', 'Wrapper', 'properties', 'list', 'items')).toEqual({
      $ref: `${ROOT}Foo`,
      title: 'Foo',
    });
  });

  it('leaves refs to untitled components untouched', () => {
    const doc = makeDoc({
      components: {
        schemas: {
          Bare: { type: 'object', properties: { x: { type: 'string' } } },
          Wrapper: { type: 'object', properties: { bare: { $ref: `${ROOT}Bare` } } },
        },
      },
    });

    applyRefTitles(doc);

    expect(at(doc, 'components', 'schemas', 'Wrapper', 'properties', 'bare')).toEqual({
      $ref: `${ROOT}Bare`,
    });
  });

  it('never overwrites a title already present on the ref', () => {
    const doc = makeDoc({
      components: {
        schemas: {
          Foo: { type: 'object', title: 'Foo', properties: {} },
          Wrapper: { type: 'object', properties: { foo: { $ref: `${ROOT}Foo`, title: 'Custom' } } },
        },
      },
    });

    applyRefTitles(doc);

    expect(at(doc, 'components', 'schemas', 'Wrapper', 'properties', 'foo')).toEqual({
      $ref: `${ROOT}Foo`,
      title: 'Custom',
    });
  });

  it('is a no-op when the doc has no components.schemas', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      paths: {},
    } as unknown as OpenAPIObject;
    expect(() => applyRefTitles(doc)).not.toThrow();
  });

  it('is a no-op when no component declares a title', () => {
    const doc = makeDoc({
      components: {
        schemas: {
          A: { type: 'object', properties: { b: { $ref: `${ROOT}B` } } },
          B: { type: 'object', properties: {} },
        },
      },
    });
    const before = JSON.stringify(doc);
    applyRefTitles(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('applyZodNest — refTitles option (end-to-end)', () => {
  const TitledSchema = z.object({ id: z.string() }).meta({ id: 'RefTitled', title: 'RefTitled' });
  class TitledDto extends createZodDto(TitledSchema) {}

  @Controller('titled')
  class TitledController {
    @Get()
    @ZodResponse({ status: HttpStatus.OK, type: [TitledDto] })
    list(): TitledDto[] {
      return [];
    }
  }

  const build = async (opts: {
    refTitles?: boolean;
  }): Promise<{ app: INestApplication; doc: OpenAPIObject }> => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [TitledController],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
    const doc = applyZodNest(SwaggerModule.createDocument(app, config), opts);
    return { app, doc };
  };

  const itemsRefAt = (doc: OpenAPIObject): unknown =>
    at(
      doc,
      'paths',
      '/titled',
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'items',
    );

  it('adds the title sibling onto the array-items ref by default', async () => {
    const { app, doc } = await build({});
    try {
      expect(itemsRefAt(doc)).toEqual({ $ref: `${ROOT}RefTitled`, title: 'RefTitled' });
    } finally {
      await app.close();
    }
  });

  it('emits a bare ref when refTitles: false', async () => {
    const { app, doc } = await build({ refTitles: false });
    try {
      expect(itemsRefAt(doc)).toEqual({ $ref: `${ROOT}RefTitled` });
    } finally {
      await app.close();
    }
  });
});
