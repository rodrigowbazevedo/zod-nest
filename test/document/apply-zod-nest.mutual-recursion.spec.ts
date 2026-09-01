import 'reflect-metadata';

import { Controller, Get, HttpStatus } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, extend, ZodResponse } from '../../src';

const ROOT = '#/components/schemas/';

const FieldSchema = z.object({ name: z.string() }).meta({ id: 'MutRec_Field' });
const FieldsetSchema = z.object({ label: z.string() }).meta({ id: 'MutRec_Fieldset' });

// Module-level mutual recursion: `extend` registers eagerly, so evaluating the
// first declaration reads the second while it is still in its dead zone.
const FieldWithRelationshipsSchema: z.ZodObject = extend(FieldSchema, (schema) =>
  schema
    .extend({ fieldset: z.lazy(() => FieldsetWithRelationshipsSchema).optional() })
    .meta({ id: 'MutRec_FieldWithRelationships' }),
);

const FieldsetWithRelationshipsSchema: z.ZodObject = extend(FieldsetSchema, (schema) =>
  schema
    .extend({ fields: z.array(z.lazy(() => FieldWithRelationshipsSchema)) })
    .meta({ id: 'MutRec_FieldsetWithRelationships' }),
);

@Controller('mutrec')
class MutualRecursionController {
  @Get('field')
  @ZodResponse({ status: HttpStatus.OK, type: FieldWithRelationshipsSchema })
  field(): unknown {
    return { name: 'n' };
  }
}

describe('applyZodNest — mutually recursive schemas registered at module scope', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [MutualRecursionController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
    doc = applyZodNest(SwaggerModule.createDocument(app, config));
  });

  afterAll(() => app.close());

  const schemas = (): Record<string, Record<string, unknown>> =>
    doc.components?.schemas as Record<string, Record<string, unknown>>;

  const deltaOf = (id: string): Record<string, unknown> => {
    const allOf = schemas()[id]?.allOf as Record<string, unknown>[] | undefined;
    return allOf?.[1] ?? {};
  };

  it('emits both sides of the cycle as components', () => {
    expect(schemas()['MutRec_FieldWithRelationships']).toBeDefined();
    expect(schemas()['MutRec_FieldsetWithRelationships']).toBeDefined();
  });

  it('adopts the lazily-referenced dependent even though it registered second', () => {
    const properties = deltaOf('MutRec_FieldWithRelationships').properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.fieldset?.$ref).toBe(`${ROOT}MutRec_FieldsetWithRelationships`);
  });

  it('closes the cycle back to the first side', () => {
    const properties = deltaOf('MutRec_FieldsetWithRelationships').properties as Record<
      string,
      Record<string, unknown>
    >;
    const items = properties.fields?.items as Record<string, unknown> | undefined;
    expect(items?.$ref).toBe(`${ROOT}MutRec_FieldWithRelationships`);
  });

  it('keeps the extend parents reachable so neither $ref dangles', () => {
    expect(schemas()['MutRec_Field']).toBeDefined();
    expect(schemas()['MutRec_Fieldset']).toBeDefined();
  });
});
