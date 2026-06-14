import 'reflect-metadata';

import SwaggerParser from '@apidevtools/swagger-parser';
import { Body, Controller, Get, Post, Query, Type } from '@nestjs/common';
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
  const doc = applyZodNest(raw);
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

  // Reproduces the cvs-kalo / bff-zod-4 case that motivated issue #55:
  // a `@Query() ZodDto` whose schema referenced a separately-named enum
  // emitted `$id: "#/components/schemas/SortDirection"` into the SortDirection
  // body. Swagger UI's strict resolver re-anchored ref lookups against the
  // leaf schema and reported "Could not resolve reference" for every named
  // component. `SwaggerParser.validate` is more permissive but the doc
  // shouldn't carry those internal fields in the first place.
  it('strips `$id` / `$schema` from named components referenced by a @Query() DTO property', async () => {
    const SortDirection = z
      .enum(['asc', 'desc'])
      .describe('The direction to sort by')
      .meta({ id: 'SortDirection', title: 'SortDirection' });
    const QuerySchema = z
      .object({
        sort: SortDirection.optional(),
        limit: z.number().describe('Page size').optional(),
      })
      .meta({ id: 'ListQueryDto' });
    class ListQueryDto extends createZodDto(QuerySchema) {}

    @Controller('items')
    class ItemsController {
      @Get()
      list(@Query() _q: ListQueryDto): unknown {
        return [];
      }
    }

    const { app, doc } = await bootstrap([ItemsController]);
    try {
      // SwaggerParser validates the 3.1 doc end-to-end.
      await expect(validate(doc)).resolves.toBeDefined();

      // The named-component body has no JSON Schema dialect metadata.
      const sortDirection = (doc.components?.schemas as Record<string, Record<string, unknown>>)
        .SortDirection!;
      expect(sortDirection).not.toHaveProperty('$id');
      expect(sortDirection).not.toHaveProperty('$schema');
      // The substantive fields survive.
      expect(sortDirection.type).toBe('string');
      expect(sortDirection.enum).toEqual(['asc', 'desc']);

      // The expanded @Query() parameters keep `description` on the schema —
      // no parameter-level duplication.
      const params = (
        doc.paths as unknown as Record<string, Record<string, Record<string, unknown>>>
      )['/items']?.get?.parameters as Array<Record<string, unknown>>;
      const limit = params.find((p) => p.name === 'limit');
      expect(limit).toBeDefined();
      expect(limit).not.toHaveProperty('description');
      expect((limit?.schema as Record<string, unknown>).description).toBe('Page size');
    } finally {
      await app.close();
    }
  });
});
