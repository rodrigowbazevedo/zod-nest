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
});
