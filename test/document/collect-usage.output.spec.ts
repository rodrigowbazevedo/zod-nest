import 'reflect-metadata';

import { Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { createZodDto, ZodResponse } from '../../src';
import { collectUsage } from '../../src/document/collect-usage.js';

class UserDto extends createZodDto(z.object({ id: z.string() }), { id: 'CollectOut_User' }) {}
class ErrorDto extends createZodDto(z.object({ msg: z.string() }), { id: 'CollectOut_Error' }) {}
class TagDto extends createZodDto(z.object({ name: z.string() }), { id: 'CollectOut_Tag' }) {}

@Controller('users')
class UsersController {
  @Get(':id')
  @ZodResponse({ status: HttpStatus.OK, type: UserDto })
  @ZodResponse({ status: HttpStatus.NOT_FOUND, type: ErrorDto })
  one(): UserDto {
    return new UserDto();
  }

  @Get()
  @ZodResponse({ type: [UserDto] })
  list(): UserDto[] {
    return [];
  }

  @Get('pair')
  @ZodResponse({ type: [UserDto, TagDto] })
  pair(): unknown {
    return [];
  }

  @Post()
  noResponse(): void {
    return;
  }
}

@Controller('plain')
class PlainController {
  @Get()
  hello(): string {
    return 'hi';
  }
}

const emptyDoc = (): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: {},
    components: { schemas: {} },
  }) as OpenAPIObject;

describe('collectUsage — controller walk (output side)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [UsersController, PlainController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('collects dtoIds from single, array, and tuple @ZodResponse variants across all controllers', () => {
    const { outputExposedIds } = collectUsage(emptyDoc(), app);
    expect([...outputExposedIds].sort()).toEqual([
      'CollectOut_Error',
      'CollectOut_Tag',
      'CollectOut_User',
    ]);
  });

  it('deduplicates ids across multiple variants referencing the same DTO', () => {
    const { outputExposedIds } = collectUsage(emptyDoc(), app);
    // UserDto appears in `one` (status 200), `list` (array), and `pair` (tuple[0]) — only one entry.
    const userCount = [...outputExposedIds].filter((id) => id === 'CollectOut_User').length;
    expect(userCount).toBe(1);
  });

  it('ignores controller handlers without @ZodResponse metadata', () => {
    // PlainController.hello and UsersController.noResponse have no @ZodResponse;
    // their absence is implicit — no errors thrown, no extra ids emitted.
    const { outputExposedIds } = collectUsage(emptyDoc(), app);
    expect(outputExposedIds.has('CollectOut_User')).toBe(true);
    expect(outputExposedIds.size).toBe(3);
  });
});

describe('collectUsage — controller walk edge cases', () => {
  it('returns empty when no controllers are registered', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [],
    }).compile();
    const localApp = moduleRef.createNestApplication({ logger: false });
    await localApp.init();

    const { outputExposedIds } = collectUsage(emptyDoc(), localApp);
    expect(outputExposedIds.size).toBe(0);

    await localApp.close();
  });
});
