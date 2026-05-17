import 'reflect-metadata';

import { z } from 'zod';

import type { ResponseVariant } from '../../src/response/metadata.js';

import { createZodDto } from '../../src';
import {
  appendResponseVariant,
  getResponseVariants,
  ZOD_RESPONSES_METADATA_KEY,
} from '../../src/response/metadata.js';

const Schema = z.object({ name: z.string() });
class FooDto extends createZodDto(Schema, { id: 'Metadata_Foo' }) {}

const makeVariant = (status: number): ResponseVariant => ({
  status,
  kind: 'single',
  dto: FooDto,
  validationSchema: FooDto.schema,
  passthroughOnError: false,
});

describe('response/metadata', () => {
  it('exports a Symbol.for-keyed metadata key (cross-realm safe)', () => {
    expect(typeof ZOD_RESPONSES_METADATA_KEY).toBe('symbol');
    expect(ZOD_RESPONSES_METADATA_KEY).toBe(Symbol.for('zod-nest.responses'));
  });

  it('returns undefined when no variants are attached', () => {
    const handler = function blank(): void {};
    expect(getResponseVariants(handler)).toBeUndefined();
  });

  it('round-trips a single variant', () => {
    const handler = function one(): void {};
    const variant = makeVariant(200);

    appendResponseVariant(handler, variant);

    const variants = getResponseVariants(handler);
    expect(variants).toHaveLength(1);
    expect(variants?.[0]).toBe(variant);
  });

  it('prepends successive variants so author-order is preserved', () => {
    // Simulates the decorator-application order for source:
    //   @ZodResponse({ status: 200 })   // applied last
    //   @ZodResponse({ status: 404 })   // applied first
    //   @ZodResponse({ status: 500 })   // applied between
    // Decorators apply bottom-up: 500 first, then 404, then 200.
    // We want runtime metadata to read top-to-bottom: [200, 404, 500].
    const handler = function ordered(): void {};

    appendResponseVariant(handler, makeVariant(500));
    appendResponseVariant(handler, makeVariant(404));
    appendResponseVariant(handler, makeVariant(200));

    const variants = getResponseVariants(handler);
    expect(variants?.map((v) => v.status)).toEqual([200, 404, 500]);
  });

  it('attaches metadata to the function itself, not the class', () => {
    const handler = function attached(): void {};
    appendResponseVariant(handler, makeVariant(200));

    expect(Reflect.getMetadata(ZOD_RESPONSES_METADATA_KEY, handler)).toBeDefined();
  });
});
