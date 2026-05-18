import { z } from 'zod';

import { createRegistry, toOpenApi } from '../../src';
import { binaryFragment, BlobSchema, BufferSchema, FileSchema } from '../../src/helpers';

describe('helpers — preset Zod schemas', () => {
  const registry = createRegistry();

  describe('FileSchema', () => {
    it('accepts a File instance at runtime', () => {
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      expect(FileSchema.safeParse(file).success).toBe(true);
    });

    it('rejects non-File values', () => {
      expect(FileSchema.safeParse('not a file').success).toBe(false);
      expect(FileSchema.safeParse(Buffer.from('x')).success).toBe(false);
    });

    it('emits binaryFragment on the input side', () => {
      expect(toOpenApi(FileSchema, { io: 'input', registry }).schema).toEqual(binaryFragment);
    });

    it('emits binaryFragment on the output side', () => {
      expect(toOpenApi(FileSchema, { io: 'output', registry }).schema).toEqual(binaryFragment);
    });
  });

  describe('BlobSchema', () => {
    it('accepts a Blob instance at runtime', () => {
      const blob = new Blob(['hello'], { type: 'text/plain' });
      expect(BlobSchema.safeParse(blob).success).toBe(true);
    });

    it('rejects non-Blob values', () => {
      expect(BlobSchema.safeParse('not a blob').success).toBe(false);
    });

    it('emits binaryFragment in OpenAPI', () => {
      expect(toOpenApi(BlobSchema, { io: 'input', registry }).schema).toEqual(binaryFragment);
    });
  });

  describe('BufferSchema', () => {
    it('accepts a Buffer instance at runtime', () => {
      const buf = Buffer.from('hello', 'utf8');
      expect(BufferSchema.safeParse(buf).success).toBe(true);
    });

    it('rejects non-Buffer values', () => {
      expect(BufferSchema.safeParse('not a buffer').success).toBe(false);
    });

    it('emits binaryFragment in OpenAPI', () => {
      expect(toOpenApi(BufferSchema, { io: 'input', registry }).schema).toEqual(binaryFragment);
    });
  });

  describe('composition inside a Zod object', () => {
    it('emits binaryFragment under the file field of an upload-like object', () => {
      const Upload = z.object({ title: z.string(), file: FileSchema });
      const out = toOpenApi(Upload, { io: 'input', registry });
      expect(out.schema).toEqual({
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: binaryFragment,
        },
        required: ['title', 'file'],
      });
    });
  });
});
