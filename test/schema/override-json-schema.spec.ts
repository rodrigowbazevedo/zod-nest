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

    it('singleOrArray pattern: a single registration on the outer pipe covers both io sides', () => {
      // Real-world coercion helper from the consumer report. Input accepts
      // `T | T[]`; output is always `T[]`. `.transform(...)` produces a pipe
      // whose `def.out` is the inner transform node — but the engine
      // suppresses the inner's strict-mode hit when an outer pipe
      // registration covers it, so consumers register only on the outer pipe.
      const item = z.string();
      const pipe = item.transform((v) => [v]);
      const schema = z.union([z.array(item), pipe]);

      const itemFrag: SchemaObject = { type: 'string' };
      const arrFrag: SchemaObject = { type: 'array', items: { type: 'string' } };
      overrideJSONSchema(pipe, { input: itemFrag, output: arrFrag });

      const inputOut = toOpenApi(schema, { io: 'input', registry }).schema;
      const outputOut = toOpenApi(schema, { io: 'output', registry }).schema;

      expect(inputOut).toEqual({ anyOf: [arrFrag, itemFrag] });
      expect(outputOut).toEqual({ anyOf: [arrFrag, arrFrag] });
    });

    it('outer-pipe coverage is io-scoped: only-`input` registration still throws on output emission', () => {
      // Sanity: the strict-mode suppression must not bleed across io sides.
      // With only `input` registered, the output pass has no covering
      // fragment, so the inner transform's empty emission stays a hit.
      const item = z.string();
      const pipe = item.transform((v) => [v]);

      overrideJSONSchema(pipe, { input: { type: 'string' } });

      expect(() => toOpenApi(pipe, { io: 'output', registry })).toThrow(
        ZodNestUnrepresentableError,
      );
    });

    it('outer-pipe coverage is registration-scoped: a bare transform without a covering pipe still throws', () => {
      // Sanity: the suppression must only trigger when an outer pipe is
      // actually registered. An anonymous transform on its own remains
      // strict-mode-unrepresentable.
      const bareTransform = z.string().transform((v) => [v]);

      expect(() => toOpenApi(bareTransform, { io: 'output', registry })).toThrow(
        ZodNestUnrepresentableError,
      );
    });

    it('nested pipes: outer-pipe coverage propagates through pipe-of-pipe chains', () => {
      // pipe-of-pipe-of-transform — coverage must walk through the chain so
      // the deepest transform's strict-mode hit is suppressed by the
      // outermost registration.
      const inner = z.string().transform((v) => parseInt(v, 10));
      const outer = inner.transform((n) => n * 2);
      const fragment: SchemaObject = { type: 'integer' };

      overrideJSONSchema(outer, { output: fragment });

      expect(toOpenApi(outer, { io: 'output', registry }).schema).toEqual(fragment);
    });
  });

  describe('description inheritance', () => {
    // `overrideJSONSchema` reads `schema.description` (the Zod v4 getter,
    // sourced from `.describe(...)` and `.meta({ description })`) at call
    // time and snapshots it onto `StoredFragments.description`. At emission
    // time, the per-direction fragment wins; if it omits `description`, the
    // captured value fills in. `title` is deliberately not inherited.
    //
    // A few tests use `z.globalRegistry.add(...)` directly to attach a
    // description without producing a clone, sidestepping an unrelated
    // strict-mode trip on the inner pre-clone instance.

    it('inherits a `.describe(...)` description when the fragment omits one', () => {
      const FileSchema = z.instanceof(File).describe('uploaded file');
      overrideJSONSchema(FileSchema, { type: 'string', format: 'binary' });

      expect(toOpenApi(FileSchema, { io: 'input', registry, strict: false }).schema).toEqual({
        type: 'string',
        format: 'binary',
        description: 'uploaded file',
      });
    });

    it('inherits a globalRegistry-set description when the fragment omits one', () => {
      const FileSchema = z.instanceof(File);
      z.globalRegistry.add(FileSchema, { description: 'uploaded file' });
      overrideJSONSchema(FileSchema, { type: 'string', format: 'binary' });

      expect(toOpenApi(FileSchema, { io: 'input', registry }).schema).toEqual({
        type: 'string',
        format: 'binary',
        description: 'uploaded file',
      });
    });

    it('fragment-supplied description wins over the captured schema description', () => {
      const FileSchema = z.instanceof(File);
      z.globalRegistry.add(FileSchema, { description: 'zod-side' });
      overrideJSONSchema(FileSchema, {
        type: 'string',
        format: 'binary',
        description: 'fragment-side',
      });

      expect(toOpenApi(FileSchema, { io: 'input', registry }).schema).toEqual({
        type: 'string',
        format: 'binary',
        description: 'fragment-side',
      });
    });

    it('does NOT inherit title from the schema (title is reserved for other schemas)', () => {
      const FileSchema = z.instanceof(File);
      z.globalRegistry.add(FileSchema, { title: 'UploadedFile', description: 'a file' });
      overrideJSONSchema(FileSchema, { type: 'string', format: 'binary' });

      const out = toOpenApi(FileSchema, { io: 'input', registry }).schema;
      expect(out).toEqual({
        type: 'string',
        format: 'binary',
        description: 'a file',
      });
      expect(out.title).toBeUndefined();
    });

    it('captures at call time: later description changes are not re-read', () => {
      const FileSchema = z.instanceof(File);
      z.globalRegistry.add(FileSchema, { description: 'at-call' });
      overrideJSONSchema(FileSchema, { type: 'string', format: 'binary' });
      z.globalRegistry.add(FileSchema, { description: 'changed-after' });

      expect(toOpenApi(FileSchema, { io: 'input', registry }).schema).toEqual({
        type: 'string',
        format: 'binary',
        description: 'at-call',
      });
    });

    it('wrapper form: captured description fills omitted sides, supplied sides are unchanged', () => {
      const Schema = z.custom<{ kind: 'thing' }>();
      z.globalRegistry.add(Schema, { description: 'shared' });
      overrideJSONSchema(Schema, {
        input: { type: 'string' },
        output: { type: 'object', description: 'out-only' },
      });

      expect(toOpenApi(Schema, { io: 'input', registry }).schema).toEqual({
        type: 'string',
        description: 'shared',
      });
      expect(toOpenApi(Schema, { io: 'output', registry }).schema).toEqual({
        type: 'object',
        description: 'out-only',
      });
    });
  });
});
