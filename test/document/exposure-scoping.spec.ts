import 'reflect-metadata';

import { Controller, Get, HttpStatus, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';

// Referenced by an endpoint → exposed. Registered but never referenced →
// pruned, unless `{ expose: true }`.
class UsedDto extends createZodDto(z.object({ id: z.string() }), { id: 'Scope_Used' }) {}
class UnusedDto extends createZodDto(z.object({ x: z.string() }), { id: 'Scope_Unused' }) {}

const ExposedDep = z.object({ v: z.string() }).meta({ id: 'Scope_ExposedDep' });
class ExposedDto extends createZodDto(z.object({ dep: ExposedDep }), {
  id: 'Scope_Exposed',
  expose: true,
}) {}

@Controller('scope')
class ScopeController {
  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: UsedDto })
  one(): UsedDto {
    return new UsedDto();
  }
}

describe('applyZodNest — reachability-scoped exposure', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    // Touch the unused / exposed DTOs so their ids register before doc build.
    void UnusedDto.id;
    void ExposedDto.id;

    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [ScopeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
    doc = applyZodNest(SwaggerModule.createDocument(app, config));
  });

  afterAll(() => app.close());

  const schemas = (): Record<string, unknown> => doc.components?.schemas as Record<string, unknown>;

  it('exposes a DTO referenced by an endpoint', () => {
    expect(schemas()['Scope_Used']).toBeDefined();
  });

  it('prunes a registered DTO that no endpoint references', () => {
    expect(schemas()['Scope_Unused']).toBeUndefined();
  });

  it('keeps an unreferenced DTO marked { expose: true } and its transitive deps', () => {
    expect(schemas()['Scope_Exposed']).toBeDefined();
    expect(schemas()['Scope_ExposedDep']).toBeDefined();
  });
});

// ─── Multi-document isolation off one shared registry ──────────────────────

class AlphaDto extends createZodDto(z.object({ a: z.string() }), { id: 'Multi_Alpha' }) {}
class BetaDto extends createZodDto(z.object({ b: z.string() }), { id: 'Multi_Beta' }) {}

@Controller('alpha')
class AlphaController {
  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: AlphaDto })
  get(): AlphaDto {
    return new AlphaDto();
  }
}

@Controller('beta')
class BetaController {
  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: BetaDto })
  get(): BetaDto {
    return new BetaDto();
  }
}

@Module({ controllers: [AlphaController] })
class AlphaModule {}

@Module({ controllers: [BetaController] })
class BetaModule {}

describe('applyZodNest — multiple documents share one registry but expose disjoint sets', () => {
  let app: INestApplication;
  let alphaDoc: OpenAPIObject;
  let betaDoc: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule, AlphaModule, BetaModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
    alphaDoc = applyZodNest(SwaggerModule.createDocument(app, config, { include: [AlphaModule] }));
    betaDoc = applyZodNest(SwaggerModule.createDocument(app, config, { include: [BetaModule] }));
  });

  afterAll(() => app.close());

  const keysOf = (doc: OpenAPIObject): string[] =>
    Object.keys((doc.components?.schemas ?? {}) as Record<string, unknown>);

  it('the alpha doc exposes only its own schema', () => {
    expect(keysOf(alphaDoc)).toContain('Multi_Alpha');
    expect(keysOf(alphaDoc)).not.toContain('Multi_Beta');
  });

  it('the beta doc exposes only its own schema', () => {
    expect(keysOf(betaDoc)).toContain('Multi_Beta');
    expect(keysOf(betaDoc)).not.toContain('Multi_Alpha');
  });
});
