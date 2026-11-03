import 'reflect-metadata';

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { test } from 'vitest';
import { z } from 'zod';

import type { Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';

const CONTROLLERS = Number(process.env.BENCH_CONTROLLERS ?? 200);

const Address = z
  .object({ street: z.string(), city: z.string(), zip: z.string().regex(/^\d{5}$/) })
  .meta({ id: 'BenchAddress' });
const Audit = z
  .object({ createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), by: z.uuid() })
  .meta({ id: 'BenchAudit' });

const buildController = (index: number): Type<unknown> => {
  const entity = z
    .object({
      id: z.uuid(),
      name: z.string().min(1).max(200),
      status: z.enum(['active', 'inactive', 'archived']),
      count: z.number().int().nonnegative(),
      price: z.number().default(0),
      tags: z.array(z.string()),
      address: Address,
      audit: Audit,
      notes: z.string().optional(),
      children: z.array(z.object({ key: z.string(), value: z.union([z.string(), z.number()]) })),
    })
    .meta({ id: `BenchEntity${index}` });
  const create = entity.omit({ id: true, audit: true }).meta({ id: `BenchCreate${index}` });
  const query = z
    .object({
      page: z.coerce.number().int().default(1),
      limit: z.coerce.number().int().max(100).default(20),
      status: z.enum(['active', 'inactive', 'archived']).optional(),
      search: z.string().optional(),
    })
    .meta({ id: `BenchQuery${index}` });
  const list = z
    .object({ items: z.array(entity), total: z.number().int() })
    .meta({ id: `BenchList${index}` });
  const params = z.object({ id: z.uuid() }).meta({ id: `BenchParams${index}` });

  class EntityDto extends createZodDto(entity) {}
  class CreateDto extends createZodDto(create) {}
  class QueryDto extends createZodDto(query) {}
  class ListDto extends createZodDto(list) {}
  class ParamsDto extends createZodDto(params) {}

  class BenchController {
    list(_query: QueryDto): ListDto {
      return { items: [], total: 0 };
    }
    findOne(_params: ParamsDto): EntityDto {
      throw new Error('unused');
    }
    create(_body: CreateDto): EntityDto {
      throw new Error('unused');
    }
    update(_params: ParamsDto, _body: CreateDto): EntityDto {
      throw new Error('unused');
    }
  }

  const proto = BenchController.prototype;
  const decorate = (key: keyof BenchController, decorators: MethodDecorator[]): void => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor === undefined) {
      throw new Error(`no ${key}`);
    }
    for (const decorator of decorators) {
      decorator(proto, key, descriptor);
    }
  };

  Reflect.defineMetadata('design:paramtypes', [QueryDto], proto, 'list');
  Query()(proto, 'list', 0);
  decorate('list', [Get(), ZodResponse({ type: ListDto })]);

  Reflect.defineMetadata('design:paramtypes', [ParamsDto], proto, 'findOne');
  Param()(proto, 'findOne', 0);
  decorate('findOne', [Get(':id'), ZodResponse({ type: EntityDto })]);

  Reflect.defineMetadata('design:paramtypes', [CreateDto], proto, 'create');
  Body()(proto, 'create', 0);
  decorate('create', [Post(), ZodResponse({ type: EntityDto })]);

  Reflect.defineMetadata('design:paramtypes', [ParamsDto, CreateDto], proto, 'update');
  Param()(proto, 'update', 0);
  Body()(proto, 'update', 1);
  decorate('update', [Post(':id'), ZodResponse({ type: EntityDto })]);

  Controller(`bench${index}`)(BenchController);
  return BenchController;
};

const controllers = Array.from({ length: CONTROLLERS }, (_, index) => buildController(index));

const rawDocument = async (): Promise<OpenAPIObject> => {
  await new Promise((resolve) => setImmediate(resolve));
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setOpenAPIVersion('3.1.0').build(),
  );
  await app.close();
  return doc;
};

const raw = await rawDocument();
applyZodNest(structuredClone(raw));

// A fresh `override` identity never matches the cached bulk emission.
test(`applyZodNest — ${CONTROLLERS} controllers, ${CONTROLLERS * 4} routes`, async ({ bench }) => {
  await bench.compare(
    bench('bulk emission recomputed', () => {
      applyZodNest(structuredClone(raw), { override: () => undefined });
    }),
    bench('bulk emission from cache', () => {
      applyZodNest(structuredClone(raw));
    }),
  );
});
