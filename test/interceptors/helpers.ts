import { lastValueFrom, of, throwError } from 'rxjs';

import type { CallHandler, ContextType, ExecutionContext, LoggerService } from '@nestjs/common';
import type { Observable } from 'rxjs';

export const makeFakeLogger = (): jest.Mocked<LoggerService> => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
});

export interface FakeContextOptions {
  statusCode?: number;
  type?: ContextType;
  handler?: (...args: unknown[]) => unknown;
  classRef?: new (...args: unknown[]) => unknown;
}

export const makeContext = (opts: FakeContextOptions = {}): ExecutionContext => {
  const handler =
    opts.handler ??
    (() => {
      /* noop */
    });
  const classRef = opts.classRef ?? class FakeController {};
  const type: ContextType = opts.type ?? 'http';
  const response = { statusCode: opts.statusCode ?? 200 };
  return {
    getType: <T extends string = ContextType>() => type as T,
    getHandler: () => handler,
    getClass: () => classRef as unknown as new (...args: unknown[]) => object,
    switchToHttp: () => ({
      getResponse: <R>() => response as unknown as R,
      getRequest: <R>() => ({}) as R,
      getNext: <N>() => undefined as unknown as N,
    }),
    switchToRpc: () => ({
      getData: <D>() => ({}) as D,
      getContext: <C>() => ({}) as C,
    }),
    switchToWs: () => ({
      getData: <D>() => ({}) as D,
      getClient: <C>() => ({}) as C,
      getPattern: () => '',
    }),
    getArgs: <T extends unknown[]>() => [] as unknown as T,
    getArgByIndex: <T>() => undefined as unknown as T,
  } as unknown as ExecutionContext;
};

export const makeNext = (value: unknown): CallHandler => ({
  handle: () => of(value) as Observable<unknown>,
});

export const makeThrowingNext = (err: unknown): CallHandler => ({
  handle: () => throwError(() => err) as Observable<unknown>,
});

export const collect = <T>(obs$: Observable<T>): Promise<T> => lastValueFrom(obs$);
