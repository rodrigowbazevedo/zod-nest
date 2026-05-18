import { binary, binaryFragment, opaque, opaqueFragment } from '../../src/helpers';

describe('helpers — sugar functions', () => {
  describe('binary()', () => {
    it('returns binaryFragment shape when called without options', () => {
      expect(binary()).toEqual({ type: 'string', format: 'binary' });
    });

    it('applies contentMediaType', () => {
      expect(binary({ contentMediaType: 'application/pdf' })).toEqual({
        type: 'string',
        format: 'binary',
        contentMediaType: 'application/pdf',
      });
    });

    it('applies contentEncoding', () => {
      expect(binary({ contentEncoding: 'base64' })).toEqual({
        type: 'string',
        format: 'binary',
        contentEncoding: 'base64',
      });
    });

    it('applies description', () => {
      expect(binary({ description: 'avatar upload' })).toEqual({
        type: 'string',
        format: 'binary',
        description: 'avatar upload',
      });
    });

    it('returns a fresh object on each call', () => {
      const a = binary();
      const b = binary();
      expect(a).not.toBe(b);
      expect(a).not.toBe(binaryFragment);
    });
  });

  describe('opaque()', () => {
    it('returns opaqueFragment shape when called without options', () => {
      expect(opaque()).toEqual({ type: 'object', additionalProperties: true });
    });

    it('applies description', () => {
      expect(opaque({ description: 'JWT passthrough' })).toEqual({
        type: 'object',
        additionalProperties: true,
        description: 'JWT passthrough',
      });
    });

    it('returns a fresh object on each call', () => {
      const a = opaque();
      const b = opaque();
      expect(a).not.toBe(b);
      expect(a).not.toBe(opaqueFragment);
    });
  });
});
