import 'reflect-metadata';

import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { ArgumentMetadata, LoggerService } from '@nestjs/common';

import { createZodDto, ZodValidationPipe } from '../../src';
import { normalizeZodNestOptions, ZOD_NEST_OPTIONS } from '../../src/module/options.js';

const body: ArgumentMetadata = { type: 'body', data: 'body', metatype: undefined };

const Schema = z.object({ name: z.string() });
class ThingDto extends createZodDto(Schema, { id: 'ModuleInjection_Thing' }) {}

const makeFakeLogger = (): jest.Mocked<LoggerService> => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
});

class CustomException extends HttpException {
  constructor() {
    super('custom', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

describe('ZodValidationPipe — ZodNestModule option injection', () => {
  it('uses the module logger on failure when validationLogs.input is enabled', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({
      validationLogs: { input: true },
      logger,
    });
    const pipe = new ZodValidationPipe(ThingDto, moduleOpts);

    await expect(
      pipe.transform({ name: 42 }, { type: 'body', data: 'body', metatype: ThingDto }),
    ).rejects.toBeDefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [payload, context] = logger.warn.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      side: 'input',
      dto: 'ThingDto',
      argType: 'body',
    });
    expect(context).toBe('ZodValidationPipe');
  });

  it('does not log when validationLogs.input is off (no-op closure)', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({
      validationLogs: { input: false, output: true },
      logger,
    });
    const pipe = new ZodValidationPipe(ThingDto, moduleOpts);

    await expect(pipe.transform({ name: 42 }, body)).rejects.toBeDefined();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('falls back to the module-level createValidationException factory when none on the per-instance arg', async () => {
    const moduleFactory = jest.fn(() => new CustomException());
    const moduleOpts = normalizeZodNestOptions({
      createValidationException: moduleFactory,
    });
    const pipe = new ZodValidationPipe(Schema, moduleOpts);

    await expect(pipe.transform({ name: 42 }, body)).rejects.toBeInstanceOf(CustomException);
    expect(moduleFactory).toHaveBeenCalledTimes(1);
  });

  it('per-instance createValidationException wins over module factory', async () => {
    const moduleFactory = jest.fn(() => new CustomException());
    const perInstanceFactory = jest.fn(
      () => new HttpException('per-instance', HttpStatus.I_AM_A_TEAPOT),
    );
    const moduleOpts = normalizeZodNestOptions({
      createValidationException: moduleFactory,
    });
    const pipe = new ZodValidationPipe(
      { schema: Schema, createValidationException: perInstanceFactory },
      moduleOpts,
    );

    let caught: unknown;
    try {
      await pipe.transform({ name: 42 }, body);
    } catch (e) {
      caught = e;
    }

    expect(moduleFactory).not.toHaveBeenCalled();
    expect(perInstanceFactory).toHaveBeenCalledTimes(1);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.I_AM_A_TEAPOT);
  });

  it('falls back to the default factory when neither per-instance nor module supply one', async () => {
    const moduleOpts = normalizeZodNestOptions({});
    const pipe = new ZodValidationPipe(Schema, moduleOpts);

    let caught: unknown;
    try {
      await pipe.transform({ name: 42 }, body);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('logs argType=query for a query-arg failure', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({
      validationLogs: true,
      logger,
    });
    const pipe = new ZodValidationPipe(Schema, moduleOpts);

    await expect(
      pipe.transform({ name: 42 }, { type: 'query', data: 'q', metatype: undefined }),
    ).rejects.toBeDefined();

    const [payload] = logger.warn.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ argType: 'query', dto: 'schema' });
  });

  it('via DI: APP_PIPE-instantiated pipe receives ZOD_NEST_OPTIONS', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({
      validationLogs: { input: true },
      logger,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [ZodValidationPipe, { provide: ZOD_NEST_OPTIONS, useValue: moduleOpts }],
    }).compile();

    const pipe = moduleRef.get(ZodValidationPipe);
    await expect(
      pipe.transform({ name: 42 }, { type: 'body', data: 'body', metatype: ThingDto }),
    ).rejects.toBeDefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('via DI without ZOD_NEST_OPTIONS provider: pipe still works (Optional fallback)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ZodValidationPipe],
    }).compile();

    const pipe = moduleRef.get(ZodValidationPipe);
    await expect(pipe.transform({ name: 'ok' }, body)).resolves.toEqual({ name: 'ok' });
  });
});
