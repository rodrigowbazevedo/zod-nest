import 'reflect-metadata';

import SwaggerParser from '@apidevtools/swagger-parser';
import { Body, Controller, Get, Post, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, extend, ZodResponse } from '../../src';

// OpenAPI 3.1 conformance check. The validator catches anything that drifts
// from the 3.1 schema (invalid $refs, malformed schema objects, missing
// required fields), so any change in `applyZodNest` that produces an
// invalid doc fails this suite.

const bootstrap = async (
  controllers: Type<unknown>[],
): Promise<{ app: INestApplication; doc: OpenAPIObject }> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  // `.setOpenAPIVersion('3.1.0')` is the canonical way to tell NestJS that
  // the doc body is OpenAPI 3.1 — otherwise DocumentBuilder defaults to
  // '3.0.0' and swagger-parser validates against the 3.0 schema, which
  // (rightly) rejects 3.1-only features in the body emitted by zod-nest.
  const config = new DocumentBuilder()
    .setTitle('conformance')
    .setVersion('0.0.0')
    .setOpenAPIVersion('3.1.0')
    .build();
  const raw = SwaggerModule.createDocument(app, config);
  const doc = applyZodNest(raw, { app });
  return { app, doc };
};

// SwaggerParser.validate accepts an `unknown`-typed doc structurally; it
// reads `openapi: '3.1.x'` and runs the matching JSON Schema validator.
// We pass a deep-clone so the parser's internal $ref dereferencing
// doesn't mutate the doc the caller asserts on later.
const validate = async (doc: OpenAPIObject): Promise<unknown> =>
  SwaggerParser.validate(JSON.parse(JSON.stringify(doc)) as never);

describe('OpenAPI 3.1 conformance', () => {
  it('validates a minimal single-DTO + single-response handler', async () => {
    const userSchema = z.object({ id: z.uuid(), name: z.string() }).meta({ id: 'ConformUser' });
    class ConformUserDto extends createZodDto(userSchema) {}

    @Controller('users')
    class UsersController {
      @Get(':id')
      @ZodResponse({ type: ConformUserDto })
      get(): ConformUserDto {
        return { id: '00000000-0000-4000-8000-000000000000', name: 'x' };
      }
    }

    const { app, doc } = await bootstrap([UsersController]);
    try {
      expect(doc.openapi).toBe('3.1.0');
      await expect(validate(doc)).resolves.toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('validates a body + multi-status stacked @ZodResponse', async () => {
    const createSchema = z
      .object({ name: z.string(), email: z.email() })
      .meta({ id: 'ConformCreateUser' });
    const userSchema = z
      .object({ id: z.uuid(), name: z.string() })
      .meta({ id: 'ConformUserStacked' });
    const errorSchema = z
      .object({ code: z.number(), message: z.string() })
      .meta({ id: 'ConformError' });

    class CreateUserDto extends createZodDto(createSchema) {}
    class UserDto extends createZodDto(userSchema) {}
    class ErrorDto extends createZodDto(errorSchema) {}

    @Controller('users')
    class UsersController {
      @Post()
      @ZodResponse({ type: UserDto })
      @ZodResponse({ status: 400, type: ErrorDto })
      create(@Body() body: CreateUserDto): UserDto {
        return { id: '00000000-0000-4000-8000-000000000000', name: body.name };
      }
    }

    const { app, doc } = await bootstrap([UsersController]);
    try {
      await expect(validate(doc)).resolves.toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('validates a doc with `extend()`-composed schemas', async () => {
    const baseSchema = z.object({ id: z.uuid(), name: z.string() }).meta({ id: 'ConformBase' });
    const adminSchema = extend(baseSchema, (s) =>
      s.extend({ permissions: z.array(z.string()) }).meta({ id: 'ConformAdmin' }),
    );

    class BaseDto extends createZodDto(baseSchema) {}
    class AdminDto extends createZodDto(adminSchema) {}

    @Controller('admins')
    class AdminsController {
      @Get('base')
      @ZodResponse({ type: BaseDto })
      base(): BaseDto {
        return { id: '00000000-0000-4000-8000-000000000000', name: 'x' };
      }

      @Get('admin')
      @ZodResponse({ type: AdminDto })
      admin(): AdminDto {
        return {
          id: '00000000-0000-4000-8000-000000000000',
          name: 'x',
          permissions: [],
        };
      }
    }

    const { app, doc } = await bootstrap([AdminsController]);
    try {
      await expect(validate(doc)).resolves.toBeDefined();
    } finally {
      await app.close();
    }
  });
});
