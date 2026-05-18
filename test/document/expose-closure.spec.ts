import { closeOverRefs, extendExposureViaRefs } from '../../src/document/expose-closure.js';

describe('closeOverRefs', () => {
  it('adds ids transitively reachable from the seed via `#/components/schemas/<id>` refs', () => {
    const bodies = new Map<string, unknown>([
      ['Root', { properties: { child: { $ref: '#/components/schemas/Mid' } } }],
      ['Mid', { properties: { leaf: { $ref: '#/components/schemas/Leaf' } } }],
      ['Leaf', { type: 'string' }],
      ['Unrelated', { type: 'number' }],
    ]);

    const out = closeOverRefs(new Set(['Root']), bodies);

    expect(out).toEqual(new Set(['Root', 'Mid', 'Leaf']));
  });

  it('returns the seed unchanged when no body has any ref', () => {
    const bodies = new Map<string, unknown>([
      ['Foo', { type: 'string' }],
      ['Bar', { type: 'number' }],
    ]);

    const out = closeOverRefs(new Set(['Foo']), bodies);

    expect(out).toEqual(new Set(['Foo']));
  });

  it('ignores `$ref`s that do not point into `#/components/schemas/`', () => {
    // Refs to parameters / responses / external URIs must not contribute
    // to schema exposure — they belong to different component buckets.
    const bodies = new Map<string, unknown>([
      [
        'Foo',
        {
          properties: {
            p: { $ref: '#/components/parameters/PageSize' },
            r: { $ref: '#/components/responses/NotFound' },
            ext: { $ref: 'https://example.com/schema.json' },
            child: { $ref: '#/components/schemas/Bar' },
          },
        },
      ],
      ['Bar', { type: 'string' }],
    ]);

    const out = closeOverRefs(new Set(['Foo']), bodies);

    expect(out).toEqual(new Set(['Foo', 'Bar']));
  });

  it('skips a seed id whose body is absent from the bodies map (no body to walk)', () => {
    // The id is in the seed but never landed in `inputSchemas`/`outputSchemas`
    // (e.g. exposed on the output side but not in the input emission). The
    // closure should keep it in the result and not crash.
    const bodies = new Map<string, unknown>();

    const out = closeOverRefs(new Set(['Orphan']), bodies);

    expect(out).toEqual(new Set(['Orphan']));
  });

  it('deduplicates: a ref reached twice contributes one entry and is not requeued', () => {
    const bodies = new Map<string, unknown>([
      [
        'Root',
        {
          properties: {
            a: { $ref: '#/components/schemas/Shared' },
            b: { $ref: '#/components/schemas/Shared' },
          },
        },
      ],
      ['Shared', { type: 'string' }],
    ]);

    const out = closeOverRefs(new Set(['Root']), bodies);

    expect(out).toEqual(new Set(['Root', 'Shared']));
  });
});

describe('extendExposureViaRefs', () => {
  it('extends both input and output exposure sets independently from their respective bodies', () => {
    const inputBodies = new Map<string, unknown>([
      ['I_Root', { properties: { c: { $ref: '#/components/schemas/I_Child' } } }],
      ['I_Child', { type: 'string' }],
    ]);
    const outputBodies = new Map<string, unknown>([
      ['O_Root', { properties: { c: { $ref: '#/components/schemas/O_Child' } } }],
      ['O_Child', { type: 'string' }],
    ]);

    const extended = extendExposureViaRefs(
      {
        inputExposedIds: new Set(['I_Root']),
        outputExposedIds: new Set(['O_Root']),
        classToDtoId: new Map(),
      },
      inputBodies,
      outputBodies,
    );

    expect(extended.inputExposedIds).toEqual(new Set(['I_Root', 'I_Child']));
    expect(extended.outputExposedIds).toEqual(new Set(['O_Root', 'O_Child']));
    // classToDtoId is preserved untouched.
    expect(extended.classToDtoId).toBeInstanceOf(Map);
    expect(extended.classToDtoId.size).toBe(0);
  });
});
