import 'reflect-metadata';

import { Controller, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ExecutionContext, INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { multerMemoryFile, ZodMultipart } from '../../src/express/index.js';
import { applyZodNest, createRegistry } from '../../src/index.js';
import {
  resolveMultipartBody,
  resolveUploadedFile,
  resolveUploadedFiles,
} from '../../src/multipart/param-decorators.js';

const registry = createRegistry();

// ─── The five bff-service multipart bodies, rebuilt on the multer helpers ───
// Four are named objects that must stay `$ref`s (their component names are
// generated TypeScript interfaces downstream); the fifth is an
// intersection-of-unions that only renders flattened.

const CopilotUploadRequest = z
  .object({ file: multerMemoryFile({ description: 'File to upload for copilot' }) })
  .meta({ id: 'CopilotUploadRequest', title: 'CopilotUploadRequest' });

const ImportListBody = z
  .object({
    file: multerMemoryFile({ mimeTypes: ['text/csv'], description: 'CSV file to import' }),
  })
  .meta({ id: 'ImportListBody', title: 'ImportListBody' });

const CsvFile = multerMemoryFile({ mimeTypes: ['text/csv'], id: 'MemoryStoredCSV' });

const CandidateInput = z.union([
  z.object({ candidate_templates: z.string().nonempty() }),
  z.object({
    candidate_trafficking: CsvFile,
    candidate_list_values: CsvFile.optional(),
  }),
]);
const ReferenceInput = z.union([
  z.object({ reference_templates: z.string().nonempty() }),
  z.object({
    reference_trafficking: CsvFile,
    reference_list_values: CsvFile.optional(),
  }),
]);
const CreateTaxonomyTranslation = z
  .intersection(CandidateInput, ReferenceInput)
  .meta({ id: 'CreateTaxonomyTranslation' });

@Controller('api')
class BffShapedController {
  @Post('copilot/upload')
  @ZodMultipart(CopilotUploadRequest, { registry })
  copilot(): null {
    return null;
  }

  @Post('lists/import')
  @ZodMultipart(ImportListBody, { registry })
  importList(): null {
    return null;
  }

  @Post('taxonomy-translations')
  @ZodMultipart(CreateTaxonomyTranslation, { flatten: true, registry })
  taxonomy(): null {
    return null;
  }

  // Anonymous schema named through the option rather than `.meta()`.
  @Post('media-plan/upload')
  @ZodMultipart(z.object({ file: multerMemoryFile(), sessionId: z.string().optional() }), {
    id: 'MediaPlanUploadRequest',
    registry,
  })
  mediaPlan(): null {
    return null;
  }

  // The pre-existing record form must keep emitting inline.
  @Post('anonymous')
  @ZodMultipart({ file: multerMemoryFile(), note: z.string() }, { registry })
  anonymous(): null {
    return null;
  }
}

const bootstrap = async (controllers: Type<unknown>[]): Promise<OpenAPIObject> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const config = new DocumentBuilder().setTitle('bff-shaped').setVersion('v').build();
  const doc = SwaggerModule.createDocument(app, config);
  await app.close();
  return applyZodNest(doc, { registry });
};

const bodyAt = (doc: OpenAPIObject, path: string): Record<string, unknown> => {
  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
  const requestBody = paths[path]?.post?.requestBody as
    { content?: Record<string, { schema?: unknown }> } | undefined;
  const schema = requestBody?.content?.['multipart/form-data']?.schema;
  if (schema === null || typeof schema !== 'object') {
    throw new Error(`No multipart schema on POST ${path}`);
  }
  return schema as Record<string, unknown>;
};

describe('@ZodMultipart schema input', () => {
  describe('named bodies emit a $ref', () => {
    it('reproduces the CopilotUploadRequest body and component', async () => {
      const doc = await bootstrap([BffShapedController]);
      expect(bodyAt(doc, '/api/copilot/upload')).toEqual({
        $ref: '#/components/schemas/CopilotUploadRequest',
        title: 'CopilotUploadRequest',
      });
      expect(doc.components?.schemas?.CopilotUploadRequest).toEqual({
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary', description: 'File to upload for copilot' },
        },
        required: ['file'],
        title: 'CopilotUploadRequest',
      });
    });

    it('reproduces the ImportListBody component, contentMediaType included', async () => {
      const doc = await bootstrap([BffShapedController]);
      expect(doc.components?.schemas?.ImportListBody).toEqual({
        type: 'object',
        properties: {
          file: {
            type: 'string',
            format: 'binary',
            contentMediaType: 'text/csv',
            description: 'CSV file to import',
          },
        },
        required: ['file'],
        title: 'ImportListBody',
      });
    });

    it('names an anonymous schema through the id option', async () => {
      const doc = await bootstrap([BffShapedController]);
      expect(bodyAt(doc, '/api/media-plan/upload')).toMatchObject({
        $ref: '#/components/schemas/MediaPlanUploadRequest',
      });
      expect(doc.components?.schemas?.MediaPlanUploadRequest).toMatchObject({
        type: 'object',
        properties: { file: { type: 'string', format: 'binary' } },
      });
    });

    it('still consumes multipart/form-data on every mode', async () => {
      const doc = await bootstrap([BffShapedController]);
      const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
      for (const path of ['/api/copilot/upload', '/api/taxonomy-translations', '/api/anonymous']) {
        const body = paths[path]?.post?.requestBody as { content: Record<string, unknown> };
        expect(Object.keys(body.content)).toEqual(['multipart/form-data']);
      }
    });
  });

  describe('composite bodies flatten inline', () => {
    it('merges the intersection-of-unions into one all-optional object', async () => {
      const doc = await bootstrap([BffShapedController]);
      const schema = bodyAt(doc, '/api/taxonomy-translations');
      expect(schema).toEqual({
        type: 'object',
        properties: {
          candidate_templates: { type: 'string', minLength: 1 },
          candidate_trafficking: { $ref: '#/components/schemas/MemoryStoredCSV' },
          candidate_list_values: { $ref: '#/components/schemas/MemoryStoredCSV' },
          reference_templates: { type: 'string', minLength: 1 },
          reference_trafficking: { $ref: '#/components/schemas/MemoryStoredCSV' },
          reference_list_values: { $ref: '#/components/schemas/MemoryStoredCSV' },
        },
      });
      // Union arms make every property optional — no `required` array at all.
      expect(schema.required).toBeUndefined();
      expect(doc.components?.schemas?.MemoryStoredCSV).toEqual({
        type: 'string',
        format: 'binary',
        contentMediaType: 'text/csv',
      });
    });
  });

  describe('the record form is unchanged', () => {
    it('emits inline with no component', async () => {
      const doc = await bootstrap([BffShapedController]);
      const schema = bodyAt(doc, '/api/anonymous');
      expect(schema.$ref).toBeUndefined();
      expect(schema).toMatchObject({
        type: 'object',
        properties: { file: { type: 'string', format: 'binary' }, note: { type: 'string' } },
      });
    });
  });
});

// ─── Param decorators against schema input ─────────────────────────────────

const makeContext = (handler: () => void, request: object): ExecutionContext =>
  ({
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const decorate = (decorator: MethodDecorator): (() => void) => {
  const handler = (): void => {
    /* noop */
  };
  decorator({}, 'upload', { value: handler });
  return handler;
};

describe('@ZodMultipart param decorators with schema input', () => {
  const paramRegistry = createRegistry();

  const memoryFile = (): Record<string, unknown> => ({
    fieldname: 'file',
    originalname: 'a.csv',
    encoding: '7bit',
    mimetype: 'text/csv',
    size: 10,
    buffer: Buffer.from('a,b'),
  });

  it('derives the flat shape from a z.object so the decorators still work', async () => {
    const handler = decorate(
      ZodMultipart(z.object({ file: multerMemoryFile(), note: z.string() }), {
        registry: paramRegistry,
      }),
    );
    await expect(
      resolveUploadedFile('file', makeContext(handler, { file: memoryFile() })),
    ).resolves.toMatchObject({ originalname: 'a.csv' });
    await expect(
      resolveMultipartBody(undefined, makeContext(handler, { body: { note: 'hi' } })),
    ).resolves.toEqual({ note: 'hi' });
  });

  describe('composite bodies have no flat shape', () => {
    const composite = z.intersection(
      z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
      z.object({ c: z.string() }),
    );
    const handler = decorate(ZodMultipart(composite, { flatten: true, registry: paramRegistry }));
    const expected = /needs a flat body shape.*composite schema.*ZodValidationPipe/s;

    it('@ZodUploadedFile reports it', async () => {
      await expect(
        resolveUploadedFile('a', makeContext(handler, { file: memoryFile() })),
      ).rejects.toThrow(expected);
    });

    it('@ZodUploadedFiles reports it, named and unnamed', async () => {
      await expect(resolveUploadedFiles('a', makeContext(handler, { files: [] }))).rejects.toThrow(
        expected,
      );
      await expect(
        resolveUploadedFiles(undefined, makeContext(handler, { files: [] })),
      ).rejects.toThrow(expected);
    });

    it('@ZodMultipartBody reports it', async () => {
      await expect(
        resolveMultipartBody(undefined, makeContext(handler, { body: {} })),
      ).rejects.toThrow(expected);
    });
  });
});
