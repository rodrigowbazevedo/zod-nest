import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

import { ZodValidationException, ZodValidationPipe } from '../../src';

const meta: ArgumentMetadata = { type: 'body', data: 'body', metatype: undefined };

describe('ZodValidationPipe — default ZodValidationException', () => {
  const schema = z.object({ name: z.string(), age: z.number() });
  const pipe = new ZodValidationPipe(schema);

  it('extends BadRequestException', async () => {
    let caught: unknown;
    try {
      await pipe.transform({ name: 1, age: 'old' }, meta);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ZodValidationException);
    expect(caught).toBeInstanceOf(BadRequestException);
  });

  it('body has statusCode 400 + message + treeified errors', async () => {
    let caught: ZodValidationException | undefined;
    try {
      await pipe.transform({ name: 1, age: 'old' }, meta);
    } catch (e) {
      caught = e as ZodValidationException;
    }
    expect(caught).toBeDefined();
    const body = caught?.getResponse() as Record<string, unknown>;
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('Validation failed');
    // z.treeifyError returns { errors, properties } shape
    const errors = body.errors as { errors?: unknown; properties?: Record<string, unknown> };
    expect(errors).toBeDefined();
    expect(errors.properties).toBeDefined();
    expect(errors.properties?.name).toBeDefined();
    expect(errors.properties?.age).toBeDefined();
  });

  it('carries the original zodError and argMetadata', async () => {
    let caught: ZodValidationException | undefined;
    try {
      await pipe.transform({ name: 1, age: 'old' }, meta);
    } catch (e) {
      caught = e as ZodValidationException;
    }
    expect(caught?.zodError).toBeInstanceOf(z.ZodError);
    expect(caught?.zodError.issues.length).toBeGreaterThan(0);
    expect(caught?.argMetadata).toEqual(meta);
  });
});
