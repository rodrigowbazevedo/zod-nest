import 'reflect-metadata';

import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiBody, ApiResponse, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';

import { createZodDto, ZOD_NEST_DTO_EXTENSION } from '../../src';

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

class SmokeUserDto extends createZodDto(UserSchema, { id: 'SmokeUserDto' }) {}

class SmokeQueryDto extends createZodDto(z.object({ limit: z.number(), q: z.string() }), {
  id: 'SmokeQueryDto',
}) {}

@Controller('smoke-users')
class SmokeUsersController {
  @Post()
  @ApiBody({ type: SmokeUserDto })
  @ApiResponse({ status: 201, type: SmokeUserDto })
  create(@Body() body: SmokeUserDto): SmokeUserDto {
    return body;
  }

  @Get()
  list(@Query() q: SmokeQueryDto): SmokeUserDto[] {
    return [q as never];
  }
}

@Module({ controllers: [SmokeUsersController] })
class SmokeAppModule {}

describe('createZodDto — @nestjs/swagger smoke', () => {
  it('places the x-zod-nest-dto placeholder on components.schemas.SmokeUserDto', async () => {
    const app = await NestFactory.create(SmokeAppModule, { logger: false });
    const config = new DocumentBuilder().setTitle('smoke').setVersion('0.0.0').build();
    const doc = SwaggerModule.createDocument(app, config);

    const schemas = doc.components?.schemas ?? {};
    const userSchema = schemas['SmokeUserDto'];
    expect(userSchema).toBeDefined();

    // The marker is wrapped as a property on the synthetic schema object.
    const properties = (userSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const marker = properties[ZOD_NEST_DTO_EXTENSION] as Record<string, unknown> | undefined;
    expect(marker).toBeDefined();
    // Marker carries the doc-merger payload — type/required are benign filler
    // (see comment in create-zod-dto.ts) that `applyZodNest` strips.
    expect(marker?.__zodNestDto).toBe(true);
    expect(marker?.dtoId).toBe('SmokeUserDto');
    expect(marker?.io).toBe('input');

    await app.close();
  });

  it('lifts the x-zod-nest-dto placeholder onto the @Query() operation parameter (pre-applyZodNest)', async () => {
    const app = await NestFactory.create(SmokeAppModule, { logger: false });
    const config = new DocumentBuilder().setTitle('smoke').setVersion('0.0.0').build();
    const doc = SwaggerModule.createDocument(app, config);

    const op = (doc.paths as Record<string, Record<string, Record<string, unknown>>> | undefined)?.[
      '/smoke-users'
    ]?.get;
    const parameters = op?.parameters as Array<Record<string, unknown>> | undefined;
    expect(parameters).toBeDefined();
    // @nestjs/swagger explodes the DTO's _OPENAPI_METADATA_FACTORY entries
    // into one parameter per property; since the marker is the only property,
    // the result is a single `x-zod-nest-dto` parameter carrying the dtoId.
    // `expandParamMarkers` (inside `applyZodNest`) is what splits this into
    // the real per-field params; this assertion just locks in the upstream
    // shape we depend on.
    expect(parameters).toHaveLength(1);
    const [marker] = parameters!;
    expect(marker?.name).toBe('x-zod-nest-dto');
    expect(marker?.__zodNestDto).toBe(true);
    expect(marker?.dtoId).toBe('SmokeQueryDto');
    expect(marker?.io).toBe('input');

    await app.close();
  });
});
