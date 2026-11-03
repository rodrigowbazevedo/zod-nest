import 'reflect-metadata';

import { Controller, Get } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ApiOperation, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';
import { reportDroppedLinks } from '../../src/document/dropped-links.js';
import { ZOD_NEST_LINKS_EXTENSION } from '../../src/schema/constants.js';

const docWith = (pathItem: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: { '/things': pathItem },
  }) as unknown as OpenAPIObject;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const responseOf = (doc: OpenAPIObject, path: string, status = '200'): Record<string, unknown> => {
  const paths: Record<string, unknown> = doc.paths;
  const pathItem = paths[path];
  if (!isRecord(pathItem) || !isRecord(pathItem.get) || !isRecord(pathItem.get.responses)) {
    throw new Error(`document has no GET responses for ${path}`);
  }
  const response = pathItem.get.responses[status];
  if (!isRecord(response)) {
    throw new Error(`document has no ${status} response for ${path}`);
  }
  return response;
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('reportDroppedLinks', () => {
  it('warns once per declared link missing from the response, naming the operation', () => {
    const doc = docWith({
      get: {
        responses: {
          200: {
            description: 'd',
            links: { kept: { operationId: 'present' } },
            [ZOD_NEST_LINKS_EXTENSION]: { kept: 'present', gone: 'getMissing', alsoGone: 'other' },
          },
        },
      },
    });

    reportDroppedLinks(doc);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`gone`'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`getMissing`'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`GET /things` response `200`'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`alsoGone`'));
  });

  it('warns when swagger removed the whole `links` object', () => {
    const doc = docWith({
      get: {
        responses: {
          200: { description: 'd', [ZOD_NEST_LINKS_EXTENSION]: { only: 'getMissing' } },
        },
      },
    });

    reportDroppedLinks(doc);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays silent when every declared link survived', () => {
    const doc = docWith({
      get: {
        responses: {
          200: {
            description: 'd',
            links: { kept: { operationId: 'present' } },
            [ZOD_NEST_LINKS_EXTENSION]: { kept: 'present' },
          },
        },
      },
    });

    reportDroppedLinks(doc);

    expect(warn).not.toHaveBeenCalled();
  });

  it('always strips the extension', () => {
    const doc = docWith({
      get: {
        responses: {
          200: { description: 'a', [ZOD_NEST_LINKS_EXTENSION]: { gone: 'x' } },
          201: {
            description: 'b',
            links: { kept: { operationId: 'y' } },
            [ZOD_NEST_LINKS_EXTENSION]: { kept: 'y' },
          },
        },
      },
    });

    reportDroppedLinks(doc);

    expect(responseOf(doc, '/things', '200')).not.toHaveProperty(ZOD_NEST_LINKS_EXTENSION);
    expect(responseOf(doc, '/things', '201')).not.toHaveProperty(ZOD_NEST_LINKS_EXTENSION);
  });

  it('reaches operations under `additionalOperations`', () => {
    const doc = docWith({
      additionalOperations: {
        SEARCH: {
          responses: { 200: { description: 'd', [ZOD_NEST_LINKS_EXTENSION]: { gone: 'x' } } },
        },
      },
    });

    reportDroppedLinks(doc);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`SEARCH /things`'));
  });

  it.each([
    ['a response that is not an object', { get: { responses: { 200: 'nope' } } }],
    ['a `$ref`-only response', { get: { responses: { 200: { $ref: '#/x' } } } }],
    ['an operation without responses', { get: {} }],
    [
      'an extension that is not an object',
      { get: { responses: { 200: { description: 'd', [ZOD_NEST_LINKS_EXTENSION]: 7 } } } },
    ],
  ])('walks past %s without throwing or warning', (_label, pathItem) => {
    expect(() => reportDroppedLinks(docWith(pathItem))).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

class LinkedThingDto extends createZodDto(z.object({ id: z.string() }), { id: 'LinkedThing' }) {}

@Controller('things')
class LinkedController {
  @Get('dangling')
  @ZodResponse({
    type: LinkedThingDto,
    description: {
      description: 'points nowhere',
      links: { Missing: { operationId: 'getMissingThing' } },
    },
  })
  dangling(): LinkedThingDto {
    return { id: 'a' };
  }

  @Get('resolved')
  @ZodResponse({
    type: LinkedThingDto,
    description: {
      description: 'points at a real operation',
      links: { Target: { operationId: 'getTargetThing' } },
    },
  })
  resolved(): LinkedThingDto {
    return { id: 'b' };
  }

  @Get('target')
  @ApiOperation({ operationId: 'getTargetThing' })
  target(): string {
    return 'c';
  }
}

const buildDocuments = async (
  controller: Type<unknown>,
): Promise<{ raw: OpenAPIObject; final: OpenAPIObject }> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers: [controller],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const raw = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setOpenAPIVersion('3.1.0').build(),
  );
  await app.close();
  const snapshot: OpenAPIObject = structuredClone(raw);
  return { raw: snapshot, final: applyZodNest(raw) };
};

describe('@ZodResponse links end to end', () => {
  it('warns exactly when @nestjs/swagger dropped the link', async () => {
    const { raw } = await buildDocuments(LinkedController);
    const swaggerDroppedIt = !isRecord(responseOf(raw, '/things/dangling').links);

    expect(warn).toHaveBeenCalledTimes(swaggerDroppedIt ? 1 : 0);
    if (swaggerDroppedIt) {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('`getMissingThing`'));
    }
  });

  it('stays silent for a link whose target operation exists', async () => {
    const { final } = await buildDocuments(LinkedController);

    expect(responseOf(final, '/things/resolved').links).toEqual({
      Target: { operationId: 'getTargetThing' },
    });
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('`Target`'));
  });

  it('leaves no extension in the final document', async () => {
    const { final } = await buildDocuments(LinkedController);

    expect(JSON.stringify(final)).not.toContain(ZOD_NEST_LINKS_EXTENSION);
  });
});
