import { z } from 'zod';

import type { Override, SchemaObject } from '../../src';

import {
  createRegistry,
  overrideJSONSchema,
  toOpenApi,
  ZodNestUnrepresentableError,
} from '../../src';

describe('overrideJSONSchema', () => {
  const registry = createRegistry();

  it('emits the registered fragment verbatim for z.instanceof(File)', () => {
    const FileSchema = z.instanceof(File);
    const fragment: SchemaObject = { type: 'string', format: 'binary' };
    overrideJSONSchema(FileSchema, fragment);

    expect(toOpenApi(FileSchema, { io: 'input', registry }).schema).toEqual(fragment);
  });

  it('emits the registered fragment verbatim for z.custom<T>()', () => {
    const BlobSchema = z.custom<Blob>((value) => value instanceof Blob);
    const fragment: SchemaObject = {
      type: 'string',
      format: 'binary',
      description: 'opaque blob',
    };
    overrideJSONSchema(BlobSchema, fragment);

    expect(toOpenApi(BlobSchema, { io: 'input', registry }).schema).toEqual(fragment);
  });

  it('regression: unregistered z.custom() still throws ZodNestUnrepresentableError in strict mode', () => {
    const NeverRegistered = z.custom<{ kind: 'never' }>();

    let thrown: unknown = undefined;
    try {
      toOpenApi(NeverRegistered, { io: 'input', registry });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ZodNestUnrepresentableError);
    expect((thrown as ZodNestUnrepresentableError).zodType).toBe('custom');
  });

  it('last-write-wins: re-registering the same schema overwrites the prior fragment', () => {
    const Schema = z.instanceof(File);
    overrideJSONSchema(Schema, { type: 'string', format: 'binary' });
    overrideJSONSchema(Schema, { type: 'string', format: 'byte', description: 'base64' });

    expect(toOpenApi(Schema, { io: 'input', registry }).schema).toEqual({
      type: 'string',
      format: 'byte',
      description: 'base64',
    });
  });

  it("caller's per-call `override` wins over a registered fragment", () => {
    const Schema = z.instanceof(File);
    overrideJSONSchema(Schema, { type: 'string', format: 'binary' });

    const userOverride: Override = ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type !== 'custom') {
        return;
      }
      jsonSchema.format = 'caller-wins';
    };

    const out = toOpenApi(Schema, { io: 'input', registry, override: userOverride }).schema;
    expect(out.format).toBe('caller-wins');
    expect(out.type).toBe('string');
  });

  it('writes the registered fragment under an object property without leaking other properties', () => {
    const FileSchema = z.instanceof(File);
    overrideJSONSchema(FileSchema, { type: 'string', format: 'binary' });

    const Body = z.object({
      file: FileSchema,
      filename: z.string(),
    });

    const out = toOpenApi(Body, { io: 'input', registry }).schema;
    expect(out.properties).toEqual({
      file: { type: 'string', format: 'binary' },
      filename: { type: 'string' },
    });
  });

  describe('input/output divergence', () => {
    it('single-fragment form applies to both input and output passes (regression)', () => {
      const FileSchema = z.instanceof(File);
      const fragment: SchemaObject = { type: 'string', format: 'binary' };
      overrideJSONSchema(FileSchema, fragment);

      expect(toOpenApi(FileSchema, { io: 'input', registry }).schema).toEqual(fragment);
      expect(toOpenApi(FileSchema, { io: 'output', registry }).schema).toEqual(fragment);
    });

    it('wrapper form with both sides: input pass emits input, output pass emits output', () => {
      const Schema = z.custom<{ kind: 'thing' }>();
      const inputFragment: SchemaObject = { type: 'string', description: 'permissive' };
      const outputFragment: SchemaObject = { type: 'object', description: 'normalized' };

      overrideJSONSchema(Schema, { input: inputFragment, output: outputFragment });

      expect(toOpenApi(Schema, { io: 'input', registry }).schema).toEqual(inputFragment);
      expect(toOpenApi(Schema, { io: 'output', registry }).schema).toEqual(outputFragment);
    });

    it('wrapper with only `output`: input pass falls through to Zod default, output pass uses fragment', () => {
      // With only `output` registered, the input pass no-ops in our override
      // and Zod emits whatever it would emit by default. For `z.custom<T>()`
      // that's `{}`, which trips strict mode — disable strict for the input
      // assertion to inspect the fallthrough.
      const Schema = z.custom<{ kind: 'thing' }>();
      const outputFragment: SchemaObject = { type: 'object', format: 'normalized' };

      overrideJSONSchema(Schema, { output: outputFragment });

      expect(toOpenApi(Schema, { io: 'input', registry, strict: false }).schema).toEqual({});
      expect(toOpenApi(Schema, { io: 'output', registry }).schema).toEqual(outputFragment);
    });

    it('wrapper with only `input`: output pass falls through to Zod default, input pass uses fragment', () => {
      const Schema = z.custom<{ kind: 'thing' }>();
      const inputFragment: SchemaObject = { type: 'string', description: 'permissive' };

      overrideJSONSchema(Schema, { input: inputFragment });

      expect(toOpenApi(Schema, { io: 'input', registry }).schema).toEqual(inputFragment);
      expect(toOpenApi(Schema, { io: 'output', registry, strict: false }).schema).toEqual({});
    });

    it('re-registering across forms is last-write-wins (single → wrapper → single)', () => {
      const Schema = z.custom<{ kind: 'thing' }>();

      overrideJSONSchema(Schema, { type: 'string', description: 'first' });
      overrideJSONSchema(Schema, {
        input: { type: 'string', description: 'wrap-in' },
        output: { type: 'string', description: 'wrap-out' },
      });
      overrideJSONSchema(Schema, { type: 'string', description: 'last' });

      const last: SchemaObject = { type: 'string', description: 'last' };
      expect(toOpenApi(Schema, { io: 'input', registry }).schema).toEqual(last);
      expect(toOpenApi(Schema, { io: 'output', registry }).schema).toEqual(last);
    });

    it("caller's per-call override still wins over the registered wrapper on the relevant side", () => {
      const Schema = z.custom<{ kind: 'thing' }>();
      overrideJSONSchema(Schema, {
        input: { type: 'string', description: 'wrap-in' },
        output: { type: 'object', description: 'wrap-out' },
      });

      const userOverride: Override = ({ zodSchema, jsonSchema }) => {
        if (zodSchema._zod.def.type !== 'custom') {
          return;
        }
        jsonSchema.description = 'caller-wins';
      };

      const inputOut = toOpenApi(Schema, { io: 'input', registry, override: userOverride }).schema;
      const outputOut = toOpenApi(Schema, {
        io: 'output',
        registry,
        override: userOverride,
      }).schema;
      expect(inputOut.description).toBe('caller-wins');
      expect(outputOut.description).toBe('caller-wins');
    });

    it('singleOrArray pattern: union(array, item.transform(v => [v])) emits divergent shapes', () => {
      // Real-world coercion helper from the consumer report. Input accepts
      // `T | T[]` (item OR array); output is always `T[]` because the
      // transform normalized the scalar branch. The Zod `.transform(...)` call
      // produces a pipe whose `def.out` is the underlying transform node —
      // register on both so the inner transform doesn't trip strict mode.
      const item = z.string();
      const pipe = item.transform((v) => [v]);
      const innerTransform = pipe._zod.def.out as unknown as z.ZodType;
      const schema = z.union([z.array(item), pipe]);

      const itemFrag: SchemaObject = { type: 'string' };
      const arrFrag: SchemaObject = { type: 'array', items: { type: 'string' } };
      overrideJSONSchema(pipe, { input: itemFrag, output: arrFrag });
      overrideJSONSchema(innerTransform, { input: itemFrag, output: arrFrag });

      const inputOut = toOpenApi(schema, { io: 'input', registry }).schema;
      const outputOut = toOpenApi(schema, { io: 'output', registry }).schema;

      expect(inputOut).toEqual({ anyOf: [arrFrag, itemFrag] });
      expect(outputOut).toEqual({ anyOf: [arrFrag, arrFrag] });
    });
  });
});
