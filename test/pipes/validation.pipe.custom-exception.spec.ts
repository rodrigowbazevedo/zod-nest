import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import type { ArgumentMetadata } from '@nestjs/common';

import { ZodValidationPipe } from '../../src';

const meta: ArgumentMetadata = { type: 'body', data: 'body', metatype: undefined };

class CustomValidationError extends HttpException {
  constructor(public readonly issuesCount: number) {
    super({ message: 'custom', issuesCount }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

describe('ZodValidationPipe — custom createValidationException', () => {
  it('invokes the factory with (zodError, argMetadata) on failure', async () => {
    const factory = jest
      .fn<unknown, [z.ZodError, ArgumentMetadata]>()
      .mockImplementation((err) => new CustomValidationError(err.issues.length));

    const schema = z.object({ x: z.string() });
    const pipe = new ZodValidationPipe({ schema, createValidationException: factory });

    let caught: unknown;
    try {
      await pipe.transform({ x: 99 }, meta);
    } catch (e) {
      caught = e;
    }

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]?.[0]).toBeInstanceOf(z.ZodError);
    expect(factory.mock.calls[0]?.[1]).toEqual(meta);
    expect(caught).toBeInstanceOf(CustomValidationError);
    expect((caught as CustomValidationError).issuesCount).toBeGreaterThan(0);
  });

  it('does not call the factory on valid input', async () => {
    const factory = jest.fn();
    const schema = z.object({ x: z.string() });
    const pipe = new ZodValidationPipe({ schema, createValidationException: factory });

    expect(await pipe.transform({ x: 'ok' }, meta)).toEqual({ x: 'ok' });
    expect(factory).not.toHaveBeenCalled();
  });
});
