import 'reflect-metadata';

import { Controller, Get } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { OpenAPIObject } from '@nestjs/swagger';
import type { Override } from '../../src/schema/override.js';
import type { ZodNestRegistry } from '../../src/schema/registry.js';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';
import { bulkEmit } from '../../src/document/bulk-emit.js';
import { ZodNestUnrepresentableError } from '../../src/schema/errors.js';
import { createRegistry } from '../../src/schema/registry.js';

const countingOverride = (): { override: Override; calls: () => number } => {
  let count = 0;
  return {
    override: () => {
      count++;
    },
    calls: () => count,
  };
};

const registryWith = (id: string): ZodNestRegistry => {
  const registry = createRegistry();
  registry.register(z.object({ name: z.string(), tags: z.array(z.string()) }), id);
  return registry;
};

describe('bulkEmit — cache', () => {
  it('emits once per registry revision and serves repeat calls from the cache', () => {
    const registry = registryWith('BulkCache_Repeat');
    const { override, calls } = countingOverride();

    const first = bulkEmit({ registry, override });
    const afterFirst = calls();
    const second = bulkEmit({ registry, override });

    expect(afterFirst).toBeGreaterThan(0);
    expect(calls()).toBe(afterFirst);
    expect(second).toEqual(first);
  });

  it('hands every caller its own copy', () => {
    const registry = registryWith('BulkCache_Isolated');

    const first = bulkEmit({ registry });
    first.inputSchemas.set('BulkCache_Isolated', { mutated: true });
    first.outputSchemas.delete('BulkCache_Isolated');
    const second = bulkEmit({ registry });

    expect(second.inputSchemas.get('BulkCache_Isolated')).not.toEqual({ mutated: true });
    expect(second.outputSchemas.has('BulkCache_Isolated')).toBe(true);
  });

  it('does not share nested bodies between callers', () => {
    const registry = registryWith('BulkCache_Nested');

    const first = bulkEmit({ registry });
    const body = first.inputSchemas.get('BulkCache_Nested');
    if (body === null || typeof body !== 'object') {
      throw new Error('expected an emitted body');
    }
    Object.assign(body, { title: 'mutated' });
    const second = bulkEmit({ registry });

    expect(second.inputSchemas.get('BulkCache_Nested')).not.toHaveProperty('title');
  });

  it('re-emits after a new registration', () => {
    const registry = registryWith('BulkCache_Before');
    bulkEmit({ registry });

    registry.register(z.object({ added: z.number() }), 'BulkCache_After');
    const next = bulkEmit({ registry });

    expect(next.inputSchemas.has('BulkCache_After')).toBe(true);
  });

  it('re-emits for a different `override` or `strict`', () => {
    const registry = registryWith('BulkCache_Options');
    const first = countingOverride();
    const second = countingOverride();

    bulkEmit({ registry, override: first.override });
    bulkEmit({ registry, override: second.override });
    bulkEmit({ registry, override: second.override, strict: false });

    expect(first.calls()).toBeGreaterThan(0);
    expect(second.calls()).toBe(first.calls() * 2);
  });

  it('keeps separate entries per registry', () => {
    const left = registryWith('BulkCache_Left');
    const right = registryWith('BulkCache_Right');

    expect([...bulkEmit({ registry: left }).inputSchemas.keys()]).toEqual(['BulkCache_Left']);
    expect([...bulkEmit({ registry: right }).inputSchemas.keys()]).toEqual(['BulkCache_Right']);
  });

  it('never caches a strict-mode failure', () => {
    const registry = createRegistry();
    registry.register(z.object({ s: z.symbol() }), 'BulkCache_Unrep');

    expect(() => bulkEmit({ registry })).toThrow(ZodNestUnrepresentableError);
    expect(() => bulkEmit({ registry })).toThrow(ZodNestUnrepresentableError);
  });

  it('emits on every call for a registry zod-nest did not create', () => {
    const registry: ZodNestRegistry = { ...registryWith('BulkCache_Foreign') };
    const { override, calls } = countingOverride();

    bulkEmit({ registry, override });
    const afterFirst = calls();
    bulkEmit({ registry, override });

    expect(calls()).toBe(afterFirst * 2);
  });
});

class CachedThingDto extends createZodDto(
  z.object({ id: z.string(), child: z.object({ key: z.string() }).meta({ id: 'CachedChild' }) }),
  { id: 'CachedThing' },
) {}

@Controller('cached')
class CachedController {
  @Get()
  @ZodResponse({ type: CachedThingDto })
  one(): CachedThingDto {
    return { id: 'a', child: { key: 'k' } };
  }
}

const buildDocument = async (): Promise<OpenAPIObject> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers: [CachedController],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const raw = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setOpenAPIVersion('3.1.0').build(),
  );
  await app.close();
  return applyZodNest(raw);
};

describe('applyZodNest — repeated documents', () => {
  it('produces identical documents when the bulk emission comes from the cache', async () => {
    const first = await buildDocument();
    const second = await buildDocument();

    expect(second).toEqual(first);
    expect(first.components?.schemas).toHaveProperty('CachedChild');
  });
});
