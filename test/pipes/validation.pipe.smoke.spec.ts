import 'reflect-metadata';

import { Body, Controller, HttpStatus, Module, Post } from '@nestjs/common';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import request from 'supertest';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';

import { createZodDto, ZodValidationPipe } from '../../src';

const CreateThingSchema = z.object({ name: z.string(), count: z.number().int().min(0) });
class CreateThingDto extends createZodDto(CreateThingSchema, { id: 'Smoke_CreateThing' }) {}

@Controller('things')
class ThingsController {
  @Post()
  create(@Body() body: CreateThingDto) {
    return { received: body };
  }
}

@Module({
  controllers: [ThingsController],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
class SmokeAppModule {}

describe('ZodValidationPipe — end-to-end smoke', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(SmokeAppModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('200/201 for valid body; handler receives parsed value', async () => {
    const res = await request(app.getHttpServer())
      .post('/things')
      .send({ name: 'widget', count: 3 });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body).toEqual({ received: { name: 'widget', count: 3 } });
  });

  it('400 with treeified errors for invalid body', async () => {
    const res = await request(app.getHttpServer()).post('/things').send({ name: 123, count: -1 });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.properties).toBeDefined();
    expect(res.body.errors.properties.name).toBeDefined();
    expect(res.body.errors.properties.count).toBeDefined();
  });
});
