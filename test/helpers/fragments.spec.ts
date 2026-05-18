import { expectTypeOf } from 'expect-type';
import { z } from 'zod';

import type { SchemaObject } from '../../src';
import type {
  BinaryFragmentOptions,
  NumberFormatOptions,
  OpaqueFragmentOptions,
  StringFormatOptions,
} from '../../src/helpers';

import { createRegistry, overrideJSONSchema, toOpenApi } from '../../src';
import {
  binaryFragment,
  byteFragment,
  dateFragment,
  dateTimeFragment,
  doubleFragment,
  emailFragment,
  enrich,
  floatFragment,
  hostnameFragment,
  int32Fragment,
  int64Fragment,
  ipv4Fragment,
  ipv6Fragment,
  opaqueFragment,
  timeFragment,
  uriFragment,
  uuidFragment,
} from '../../src/helpers';

describe('helpers — fragment catalog', () => {
  describe('shapes', () => {
    const cases: ReadonlyArray<readonly [string, SchemaObject, SchemaObject]> = [
      ['dateTimeFragment', dateTimeFragment, { type: 'string', format: 'date-time' }],
      ['dateFragment', dateFragment, { type: 'string', format: 'date' }],
      ['timeFragment', timeFragment, { type: 'string', format: 'time' }],
      ['uuidFragment', uuidFragment, { type: 'string', format: 'uuid' }],
      ['emailFragment', emailFragment, { type: 'string', format: 'email' }],
      ['uriFragment', uriFragment, { type: 'string', format: 'uri' }],
      ['hostnameFragment', hostnameFragment, { type: 'string', format: 'hostname' }],
      ['ipv4Fragment', ipv4Fragment, { type: 'string', format: 'ipv4' }],
      ['ipv6Fragment', ipv6Fragment, { type: 'string', format: 'ipv6' }],
      ['binaryFragment', binaryFragment, { type: 'string', format: 'binary' }],
      ['byteFragment', byteFragment, { type: 'string', format: 'byte' }],
      ['int32Fragment', int32Fragment, { type: 'integer', format: 'int32' }],
      ['int64Fragment', int64Fragment, { type: 'integer', format: 'int64' }],
      ['floatFragment', floatFragment, { type: 'number', format: 'float' }],
      ['doubleFragment', doubleFragment, { type: 'number', format: 'double' }],
      ['opaqueFragment', opaqueFragment, { type: 'object', additionalProperties: true }],
    ];

    it.each(cases)('%s emits the expected JSON Schema shape', (_name, actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  describe('enrich()', () => {
    it('merges string-format extras onto a string-format fragment', () => {
      expect(enrich(uuidFragment, { description: 'User id', minLength: 36 })).toEqual({
        type: 'string',
        format: 'uuid',
        description: 'User id',
        minLength: 36,
      });
    });

    it('merges binary extras onto binaryFragment', () => {
      expect(enrich(binaryFragment, { contentMediaType: 'application/pdf' })).toEqual({
        type: 'string',
        format: 'binary',
        contentMediaType: 'application/pdf',
      });
    });

    it('merges numeric extras onto an integer-format fragment', () => {
      expect(enrich(int64Fragment, { minimum: 0, multipleOf: 100 })).toEqual({
        type: 'integer',
        format: 'int64',
        minimum: 0,
        multipleOf: 100,
      });
    });

    it('merges opaque extras onto opaqueFragment', () => {
      expect(enrich(opaqueFragment, { description: 'JWT passthrough' })).toEqual({
        type: 'object',
        additionalProperties: true,
        description: 'JWT passthrough',
      });
    });

    it('does not mutate the source fragment', () => {
      const before = { ...uuidFragment };
      enrich(uuidFragment, { description: 'side-effect probe' });
      expect(uuidFragment).toEqual(before);
    });

    it('compile-time: wrong-family extras error', () => {
      // @ts-expect-error - contentMediaType is a binary option, not a string-format option
      enrich(uuidFragment, { contentMediaType: 'application/pdf' });

      // @ts-expect-error - minLength is a string option, not a numeric option
      enrich(int32Fragment, { minLength: 1 });

      // @ts-expect-error - minimum is a numeric option, not an opaque option
      enrich(opaqueFragment, { minimum: 0 });

      expect(true).toBe(true);
    });

    it('compile-time: option types are mapped per family', () => {
      type UuidOptions = Parameters<typeof enrich<typeof uuidFragment>>[1];
      type BinaryOptions = Parameters<typeof enrich<typeof binaryFragment>>[1];
      type IntOptions = Parameters<typeof enrich<typeof int32Fragment>>[1];
      type OpaqueOptions = Parameters<typeof enrich<typeof opaqueFragment>>[1];

      expectTypeOf<UuidOptions>().toEqualTypeOf<StringFormatOptions>();
      expectTypeOf<BinaryOptions>().toEqualTypeOf<BinaryFragmentOptions>();
      expectTypeOf<IntOptions>().toEqualTypeOf<NumberFormatOptions>();
      expectTypeOf<OpaqueOptions>().toEqualTypeOf<OpaqueFragmentOptions>();
    });
  });

  describe('end-to-end emission through overrideJSONSchema + toOpenApi', () => {
    const registry = createRegistry();

    it('emits a string-format fragment for a custom schema', () => {
      const UserIdSchema = overrideJSONSchema(z.custom<string>(), uuidFragment);
      expect(toOpenApi(UserIdSchema, { io: 'input', registry }).schema).toEqual(uuidFragment);
    });

    it('emits a binary fragment for an instanceof schema', () => {
      const FileLike = overrideJSONSchema(z.instanceof(File), binaryFragment);
      expect(toOpenApi(FileLike, { io: 'input', registry }).schema).toEqual(binaryFragment);
    });

    it('emits a numeric-format fragment for a custom number schema', () => {
      const BigCounter = overrideJSONSchema(z.custom<number>(), int64Fragment);
      expect(toOpenApi(BigCounter, { io: 'output', registry }).schema).toEqual(int64Fragment);
    });

    it('emits an opaque-object fragment for z.unknown()', () => {
      const Payload = overrideJSONSchema(z.unknown(), opaqueFragment);
      expect(toOpenApi(Payload, { io: 'output', registry }).schema).toEqual(opaqueFragment);
    });

    it('emits an enriched fragment when registered via enrich()', () => {
      const Tagged = overrideJSONSchema(
        z.custom<string>(),
        enrich(uuidFragment, { description: 'tagged user id' }),
      );
      expect(toOpenApi(Tagged, { io: 'input', registry }).schema).toEqual({
        type: 'string',
        format: 'uuid',
        description: 'tagged user id',
      });
    });
  });
});
