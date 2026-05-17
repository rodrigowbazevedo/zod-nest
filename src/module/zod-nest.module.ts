import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import type { DynamicModule } from '@nestjs/common';
import type { ZodNestModuleOptions } from './options.js';

import { ZodSerializerInterceptor } from '../interceptors/serializer.interceptor.js';
import { ZodValidationPipe } from '../pipes/validation.pipe.js';
import { normalizeZodNestOptions, ZOD_NEST_OPTIONS } from './options.js';

/**
 * Central wiring for the zod-nest pipe + interceptor. Call
 * `ZodNestModule.forRoot(options?)` from your root `AppModule` to register
 * `APP_PIPE` (`ZodValidationPipe`) and `APP_INTERCEPTOR`
 * (`ZodSerializerInterceptor`) globally, with shared options for
 * validation logging, redaction, and exception factories.
 *
 * `forRoot()` is optional — the pipe and interceptor also work as
 * regular `APP_PIPE` / `APP_INTERCEPTOR` providers if you prefer to
 * wire them manually; `@Optional()` injection of `ZOD_NEST_OPTIONS`
 * falls through to safe defaults.
 *
 * Marked `global` so the `ZOD_NEST_OPTIONS` token is injectable from
 * feature modules (e.g. a custom pipe that wants the same logger /
 * redact list as the module-wired one).
 */
export class ZodNestModule {
  static forRoot(options?: ZodNestModuleOptions): DynamicModule {
    const normalized = normalizeZodNestOptions(options);
    return {
      module: ZodNestModule,
      global: true,
      providers: [
        { provide: ZOD_NEST_OPTIONS, useValue: normalized },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
      ],
      exports: [ZOD_NEST_OPTIONS],
    };
  }
}
