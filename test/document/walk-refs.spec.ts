import { walkRefs } from '../../src/document/walk-refs.js';

describe('walkRefs', () => {
  it('visits every `$ref` in a nested tree', () => {
    const refs: string[] = [];
    walkRefs(
      {
        a: { $ref: '#/A' },
        b: { nested: { $ref: '#/B' } },
        c: [{ $ref: '#/C' }, { d: { $ref: '#/D' } }],
      },
      (ref) => {
        refs.push(ref);
        return undefined;
      },
    );
    expect(refs.sort()).toEqual(['#/A', '#/B', '#/C', '#/D']);
  });

  it('mutates refs in place when the visitor returns a replacement', () => {
    const doc = {
      one: { $ref: '#/old' },
      two: { $ref: '#/keep' },
      three: { nested: { $ref: '#/old' } },
    };
    walkRefs(doc, (ref) => (ref === '#/old' ? '#/new' : undefined));

    expect(doc.one.$ref).toBe('#/new');
    expect(doc.two.$ref).toBe('#/keep');
    expect(doc.three.nested.$ref).toBe('#/new');
  });

  it('leaves non-string `$ref` values alone', () => {
    const doc = { $ref: 42 as unknown as string };
    walkRefs(doc, () => 'should-not-apply');
    expect(doc.$ref).toBe(42);
  });

  it('is a no-op for primitives and null', () => {
    expect(() => walkRefs(null, () => 'x')).not.toThrow();
    expect(() => walkRefs(undefined, () => 'x')).not.toThrow();
    expect(() => walkRefs(42, () => 'x')).not.toThrow();
    expect(() => walkRefs('foo', () => 'x')).not.toThrow();
  });
});
