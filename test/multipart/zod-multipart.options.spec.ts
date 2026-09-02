import 'reflect-metadata';

import { Controller, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type {
  MulterFileOptions,
  MultipartShape,
  ZodMultipartOptions,
} from '../../src/express/index.js';
import type { FastifyMultipartFileOptions } from '../../src/fastify/index.js';

import { multerMemoryFile, MULTIPART_CONTENT_TYPE, ZodMultipart } from '../../src/express/index.js';
import { fastifyMultipartFile } from '../../src/fastify/index.js';
import { applyZodNest, createRegistry } from '../../src/index.js';

const registry = createRegistry();

// Hoisted so the shape is declared once and shared across handlers — the
// pattern docs/recipes/multipart-uploads.md recommends.
const UploadShape = {
  report: multerMemoryFile({ mimeTypes: ['text/csv'] }),
  label: z.string(),
} satisfies MultipartShape;

@Controller('opts')
class OptionsController {
  @Post('described')
  @ZodMultipart(UploadShape, {
    registry,
    description: 'Quarterly report upload',
  } satisfies ZodMultipartOptions)
  described(): null {
    return null;
  }

  @Post('optional-body')
  @ZodMultipart(UploadShape, { registry, required: false })
  optionalBody(): null {
    return null;
  }

  // Named descendants of the shape have to reach the registry, or their
  // `$ref`s dangle when `applyZodNest` assembles components.schemas.
  @Post('named-parts')
  @ZodMultipart(
    {
      report: multerMemoryFile({ mimeTypes: ['text/csv'], id: 'NamedReportFile' }),
      options: z
        .object({ dryRun: z.stringbool(), label: z.string() })
        .meta({ id: 'NamedImportOptions' }),
    },
    { registry },
  )
  namedParts(): null {
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
  const config = new DocumentBuilder().setTitle('multipart-options').setVersion('v').build();
  const doc = SwaggerModule.createDocument(app, config);
  await app.close();
  return doc;
};

const requestBodyAt = (
  doc: OpenAPIObject,
  path: string,
): { description?: string; required?: boolean; content: Record<string, unknown> } => {
  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
  const body = paths[path]?.post?.requestBody;
  if (body === null || typeof body !== 'object') {
    throw new Error(`No requestBody on POST ${path}`);
  }
  return body as { description?: string; required?: boolean; content: Record<string, unknown> };
};

describe('@ZodMultipart options', () => {
  it('exposes the multipart content type it emits under', () => {
    expect(MULTIPART_CONTENT_TYPE).toBe('multipart/form-data');
  });

  it('passes description through to the request body', async () => {
    const doc = await bootstrap([OptionsController]);
    const body = requestBodyAt(doc, '/opts/described');
    expect(body.description).toBe('Quarterly report upload');
    expect(body.required).toBe(true);
    expect(Object.keys(body.content)).toEqual([MULTIPART_CONTENT_TYPE]);
  });

  it('honours required: false', async () => {
    const doc = await bootstrap([OptionsController]);
    expect(requestBodyAt(doc, '/opts/optional-body').required).toBe(false);
  });

  it('registers named descendants so their $refs resolve', async () => {
    const doc = applyZodNest(await bootstrap([OptionsController]), { registry });
    const schema = requestBodyAt(doc, '/opts/named-parts').content['multipart/form-data'];
    expect(schema).toMatchObject({
      schema: {
        properties: {
          report: { $ref: '#/components/schemas/NamedReportFile' },
          options: { $ref: '#/components/schemas/NamedImportOptions' },
        },
      },
    });
    expect(doc.components?.schemas?.NamedReportFile).toMatchObject({
      type: 'string',
      format: 'binary',
    });
    expect(doc.components?.schemas?.NamedImportOptions).toMatchObject({ type: 'object' });
  });

  it('types the per-platform option bags', () => {
    const multerOptions = {
      maxSize: 1024,
      mimeTypes: ['image/png'],
      extensions: ['png'],
      description: 'An image',
      contentMediaType: 'image/png',
    } satisfies MulterFileOptions;

    // No maxSize on the fastify side — a MultipartFile reports no size.
    const fastifyOptions = {
      mimeTypes: ['application/pdf'],
      extensions: ['pdf'],
    } satisfies FastifyMultipartFileOptions;

    expect(multerMemoryFile(multerOptions).safeParse(undefined).success).toBe(false);
    expect(fastifyMultipartFile(fastifyOptions).safeParse(undefined).success).toBe(false);
  });
});
