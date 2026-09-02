import 'reflect-metadata';

import { Controller, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { FastifyMultipartFileLike } from '../../src/fastify/index.js';

import { fastifyMultipartFile, ZodMultipart, ZodMultipartBody } from '../../src/fastify/index.js';
import { applyZodNest, createRegistry } from '../../src/index.js';

const registry = createRegistry();

@Controller('uploads')
class FastifyUploadController {
  @Post('document')
  @ZodMultipart(
    {
      document: fastifyMultipartFile({ mimeTypes: ['application/pdf'] }),
      title: z.string().min(1),
    },
    { registry },
  )
  // Under attachFieldsToBody: true the file arrives in the body, so one
  // decorator covers both halves.
  upload(
    @ZodMultipartBody() body: { document: FastifyMultipartFileLike; title: string },
  ): Record<string, unknown> {
    return { title: body.title, filename: body.document.filename };
  }
}

const bootstrap = async (
  controllers: Type<unknown>[],
): Promise<{ app: INestApplication; doc: OpenAPIObject }> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const config = new DocumentBuilder().setTitle('fastify-multipart-smoke').setVersion('v').build();
  return { app, doc: applyZodNest(SwaggerModule.createDocument(app, config), { registry }) };
};

describe('fastify multipart document', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    ({ app, doc } = await bootstrap([FastifyUploadController]));
  });

  afterAll(async () => {
    await app.close();
  });

  it('emits the file alongside the text fields in one inline body', () => {
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    const body = paths['/uploads/document']?.post?.requestBody as {
      content: Record<string, { schema: unknown }>;
    };
    expect(Object.keys(body.content)).toEqual(['multipart/form-data']);
    expect(body.content['multipart/form-data']?.schema).toEqual({
      type: 'object',
      properties: {
        document: { type: 'string', format: 'binary', contentMediaType: 'application/pdf' },
        title: { type: 'string', minLength: 1 },
      },
      required: ['document', 'title'],
    });
  });
});
