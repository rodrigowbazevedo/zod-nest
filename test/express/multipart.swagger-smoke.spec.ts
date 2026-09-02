import 'reflect-metadata';

import { Controller, Post, UseInterceptors } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { FileFieldsInterceptor, FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { MulterMemoryFileLike } from '../../src/express/index.js';

import {
  multerMemoryFile,
  ZodMultipart,
  ZodMultipartBody,
  ZodUploadedFile,
  ZodUploadedFiles,
} from '../../src/express/index.js';
import { applyZodNest, createRegistry } from '../../src/index.js';

const registry = createRegistry();

const AvatarShape = {
  avatar: multerMemoryFile({
    maxSize: 1024,
    mimeTypes: ['image/png'],
    description: 'Profile picture',
  }),
  name: z.string().min(1),
  age: z.coerce.number().int(),
};

@Controller('uploads')
class UploadController {
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  @ZodMultipart(AvatarShape, { registry })
  uploadAvatar(
    @ZodUploadedFile('avatar') avatar: MulterMemoryFileLike,
    @ZodMultipartBody() body: { name: string; age: number },
  ): Record<string, unknown> {
    return { originalname: avatar.originalname, bytes: avatar.buffer.length, ...body };
  }

  @Post('photos')
  @UseInterceptors(FilesInterceptor('photos', 3))
  @ZodMultipart({ photos: z.array(multerMemoryFile()).max(3), album: z.string() }, { registry })
  uploadPhotos(
    @ZodUploadedFiles('photos') photos: MulterMemoryFileLike[],
    @ZodMultipartBody() body: { album: string },
  ): Record<string, unknown> {
    return { count: photos.length, album: body.album };
  }

  @Post('branding')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'logo', maxCount: 1 },
      { name: 'banner', maxCount: 1 },
    ]),
  )
  @ZodMultipart(
    { logo: z.array(multerMemoryFile()), banner: z.array(multerMemoryFile()) },
    { registry },
  )
  uploadBranding(
    @ZodUploadedFiles() files: { logo: MulterMemoryFileLike[]; banner: MulterMemoryFileLike[] },
  ): Record<string, unknown> {
    return { logo: files.logo[0]?.originalname, banner: files.banner[0]?.originalname };
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
  const config = new DocumentBuilder().setTitle('multipart-smoke').setVersion('v').build();
  const raw = SwaggerModule.createDocument(app, config);
  return { app, doc: applyZodNest(raw, { registry }) };
};

const opAt = (doc: OpenAPIObject, path: string): Record<string, unknown> => {
  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const op = paths?.[path]?.post;
  if (op === undefined) {
    throw new Error(`No POST ${path}`);
  }
  return op;
};

const multipartSchema = (op: Record<string, unknown>): Record<string, unknown> => {
  const body = op.requestBody as { content?: Record<string, { schema?: unknown }> } | undefined;
  const schema = body?.content?.['multipart/form-data']?.schema;
  if (schema === null || typeof schema !== 'object') {
    throw new Error('No multipart/form-data schema on the operation');
  }
  return schema as Record<string, unknown>;
};

describe('multipart uploads end to end', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    ({ app, doc } = await bootstrap([UploadController]));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('document', () => {
    it('emits a flat inline multipart body with files and text fields together', () => {
      expect(multipartSchema(opAt(doc, '/uploads/avatar'))).toEqual({
        type: 'object',
        properties: {
          avatar: {
            type: 'string',
            format: 'binary',
            contentMediaType: 'image/png',
            description: 'Profile picture',
          },
          name: { type: 'string', minLength: 1 },
          age: {
            type: 'integer',
            minimum: Number.MIN_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        },
        required: ['avatar', 'name', 'age'],
      });
    });

    // Swagger UI's try-it-out form generator won't follow a $ref, so the body
    // must be inline rather than a components.schemas entry.
    it('does not put the multipart body in components.schemas', () => {
      const schema = multipartSchema(opAt(doc, '/uploads/avatar'));
      expect(schema.$ref).toBeUndefined();
      expect(Object.keys(doc.components?.schemas ?? {})).toEqual([]);
    });

    it('emits an array of binaries for a repeated file field', () => {
      expect(multipartSchema(opAt(doc, '/uploads/photos'))).toMatchObject({
        properties: {
          photos: { type: 'array', maxItems: 3, items: { type: 'string', format: 'binary' } },
          album: { type: 'string' },
        },
      });
    });

    it('sets multipart/form-data as the only consumed content type', () => {
      for (const path of ['/uploads/avatar', '/uploads/photos', '/uploads/branding']) {
        const body = opAt(doc, path).requestBody as { content: Record<string, unknown> };
        expect(Object.keys(body.content)).toEqual(['multipart/form-data']);
      }
    });
  });

  describe('runtime', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');

    it('validates and injects a single file plus coerced text fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/uploads/avatar')
        .field('name', 'Ada')
        .field('age', '36')
        .attach('avatar', png, { filename: 'avatar.png', contentType: 'image/png' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        originalname: 'avatar.png',
        bytes: png.length,
        name: 'Ada',
        age: 36,
      });
    });

    it('rejects a file whose mimetype is not allowed', async () => {
      const response = await request(app.getHttpServer())
        .post('/uploads/avatar')
        .field('name', 'Ada')
        .field('age', '36')
        .attach('avatar', Buffer.from('a,b'), { filename: 'data.csv', contentType: 'text/csv' });

      expect(response.status).toBe(400);
    });

    it('rejects a file over maxSize', async () => {
      const response = await request(app.getHttpServer())
        .post('/uploads/avatar')
        .field('name', 'Ada')
        .field('age', '36')
        .attach('avatar', Buffer.alloc(2048), { filename: 'big.png', contentType: 'image/png' });

      expect(response.status).toBe(400);
    });

    it('rejects a bad text field', async () => {
      const response = await request(app.getHttpServer())
        .post('/uploads/avatar')
        .field('name', 'Ada')
        .field('age', 'not-a-number')
        .attach('avatar', png, { filename: 'avatar.png', contentType: 'image/png' });

      expect(response.status).toBe(400);
    });

    it('validates an array of files', async () => {
      const response = await request(app.getHttpServer())
        .post('/uploads/photos')
        .field('album', 'holiday')
        .attach('photos', png, { filename: 'a.png', contentType: 'image/png' })
        .attach('photos', png, { filename: 'b.png', contentType: 'image/png' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ count: 2, album: 'holiday' });
    });

    it('validates the record shape FileFieldsInterceptor produces', async () => {
      const response = await request(app.getHttpServer())
        .post('/uploads/branding')
        .attach('logo', png, { filename: 'logo.png', contentType: 'image/png' })
        .attach('banner', png, { filename: 'banner.png', contentType: 'image/png' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ logo: 'logo.png', banner: 'banner.png' });
    });
  });
});
