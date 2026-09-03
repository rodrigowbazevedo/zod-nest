import 'reflect-metadata';

import { Controller, Get, HttpStatus } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';

// A gRPC/protobuf wire codec: named for internal reuse, never an endpoint type.
// protobuf-es models an unset `oneof` as `{ case: undefined }`, which strict
// mode rejects — but this schema is not zod-nest's to emit or check.
z.object({ unsetCase: z.undefined() }).meta({ id: 'ForeignRegistry_GrpcWire' });

const UserSchema = z.object({ id: z.string() }).meta({ id: 'ForeignRegistry_User' });

class UserDto extends createZodDto(UserSchema) {}

@Controller('foreign')
class ForeignController {
  @Get('user')
  @ZodResponse({ status: HttpStatus.OK, type: UserDto })
  user(): unknown {
    return { id: 'u1' };
  }
}

describe('applyZodNest — foreign z.globalRegistry entries', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [ForeignController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  const build = (): OpenAPIObject => {
    const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
    return applyZodNest(SwaggerModule.createDocument(app, config));
  };

  it('builds the document in strict mode despite an unrepresentable foreign schema', () => {
    expect(() => build()).not.toThrow();
  });

  it('leaves the foreign id out of the document entirely', () => {
    const doc = build();

    expect(doc.components?.schemas).toHaveProperty('ForeignRegistry_User');
    expect(doc.components?.schemas).not.toHaveProperty('ForeignRegistry_GrpcWire');
    expect(JSON.stringify(doc)).not.toContain('ForeignRegistry_GrpcWire');
  });
});
