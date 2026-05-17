import { ZodNestDocumentError } from '../../src/document/errors.js';
import { ZodNestError } from '../../src/schema/errors.js';

describe('ZodNestDocumentError', () => {
  it('inherits ZodNestError and tags the name', () => {
    const err = new ZodNestDocumentError('AMBIGUOUS_RENAME', 'something is ambiguous');
    expect(err).toBeInstanceOf(ZodNestError);
    expect(err.name).toBe('ZodNestDocumentError');
  });

  it('prefixes the message with the package + code', () => {
    const err = new ZodNestDocumentError('DANGLING_REF', 'missing #/components/schemas/Lost');
    expect(err.message).toBe('[zod-nest] DANGLING_REF: missing #/components/schemas/Lost');
  });

  it('exposes the code + details', () => {
    const err = new ZodNestDocumentError('AMBIGUOUS_RENAME', 'collision', { key: 'User' });
    expect(err.code).toBe('AMBIGUOUS_RENAME');
    expect(err.details).toEqual({ key: 'User' });
  });

  it('defaults details to an empty object when omitted', () => {
    const err = new ZodNestDocumentError('DANGLING_REF', 'x');
    expect(err.details).toEqual({});
  });
});
