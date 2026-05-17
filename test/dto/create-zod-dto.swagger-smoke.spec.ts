import 'reflect-metadata';

import { Body, Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiBody, ApiResponse, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';

import { createZodDto, ZOD_NEST_DTO_EXTENSION } from '../../src';

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

class SmokeUserDto extends createZodDto(UserSchema, { id: 'SmokeUserDto' }) {}

@Controller('smoke-users')
class SmokeUsersController {
  @Post()
  @ApiBody({ type: SmokeUserDto })
  @ApiResponse({ status: 201, type: SmokeUserDto })
  create(@Body() body: SmokeUserDto): SmokeUserDto {
    return body;
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
});
