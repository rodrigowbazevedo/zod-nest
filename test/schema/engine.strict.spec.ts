import { z } from 'zod';

import {
  createRegistry,
  overrideJSONSchema,
  toOpenApi,
  ZodNestUnrepresentableError,
} from '../../src';
import { binaryFragment } from '../../src/helpers/index.js';

describe('toOpenApi — strict mode', () => {
  const registry = createRegistry();

  it('strict default throws on z.symbol() with JSON path', () => {
    let thrown: unknown = undefined;
    try {
      toOpenApi(z.object({ s: z.symbol() }), { io: 'output', registry });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ZodNestUnrepresentableError);
    expect((thrown as ZodNestUnrepresentableError).path).toEqual(['properties', 's']);
  });

  it('strict: false emits `{}` for unrepresentable type', () => {
    const out = toOpenApi(z.object({ s: z.symbol() }), {
      io: 'output',
      registry,
      strict: false,
    }).schema;
    expect(out.properties?.s).toEqual({});
  });

  it('strict: true accepts z.any() (legitimate `{}` not flagged)', () => {
    const out = toOpenApi(z.any(), { io: 'output', registry }).schema;
    expect(out).toEqual({});
  });

  // `markPipeCoverage` walks a registered pipe's descent target so the inner
  // schema isn't reported unrepresentable. The visited set is per-emission, so
  // two registered pipes over the same inner schema exercise its cycle guard.
  it('handles two registered pipes sharing one inner schema', () => {
    const shared = z.string();
    const asInteger = overrideJSONSchema(z.pipe(shared, z.string().min(1)), { type: 'integer' });
    const asNumber = overrideJSONSchema(z.pipe(shared, z.string().min(2)), { type: 'number' });

    const out = toOpenApi(z.object({ a: asInteger, b: asNumber }), {
      io: 'input',
      registry: createRegistry(),
      strict: true,
    }).schema;

    expect(out.properties).toEqual({ a: { type: 'integer' }, b: { type: 'number' } });
  });

  // A registered pipe's descent target differs per side: the output side when
  // emitting output, or when the input side is itself a bare transform.
  it('descends the output side when emitting output', () => {
    const piped = overrideJSONSchema(z.pipe(z.string(), z.string().min(1)), {
      input: { type: 'string' },
      output: { type: 'integer' },
    });

    const out = toOpenApi(z.object({ a: piped }), {
      io: 'output',
      registry: createRegistry(),
      strict: true,
    }).schema;

    expect(out.properties).toEqual({ a: { type: 'integer' } });
  });

  it('descends the output side when the input side is a bare transform', () => {
    const piped = overrideJSONSchema(
      z.pipe(
        z.transform((value: string) => value.length),
        z.number(),
      ),
      { type: 'integer' },
    );

    const out = toOpenApi(z.object({ a: piped }), {
      io: 'input',
      registry: createRegistry(),
      strict: true,
    }).schema;

    expect(out.properties).toEqual({ a: { type: 'integer' } });
  });

  // `.meta()` is an annotation clone — it shares the def, so the fragment
  // registered on the pre-clone instance resolves through the chain.
  it('inherits the fragment when naming an overridden schema', () => {
    const base = overrideJSONSchema(
      z.custom<{ a: string }>(() => true),
      binaryFragment,
    );
    const named = base.meta({ id: 'AnnotationOnly', title: 'AnnotationOnly' });

    const { refs } = toOpenApi(z.object({ f: named }), { io: 'input', registry });
    expect(refs.get('AnnotationOnly')).toMatchObject({ type: 'string', format: 'binary' });
  });

  it('keeps the clone own description over the ancestor captured one', () => {
    const base = overrideJSONSchema(
      z.custom<{ a: string }>(() => true),
      binaryFragment,
    );
    const described = base.meta({ id: 'DescribedOnly', description: 'a file' });

    const { refs } = toOpenApi(z.object({ f: described }), { io: 'input', registry });
    expect(refs.get('DescribedOnly')).toMatchObject({
      type: 'string',
      format: 'binary',
      description: 'a file',
    });
  });

  it('still flags a genuinely unregistered annotation-only body', () => {
    const orphan = z.custom<{ a: string }>(() => true).meta({ id: 'Orphan', title: 'Orphan' });

    expect(() => toOpenApi(z.object({ f: orphan }), { io: 'input', registry })).toThrow(
      ZodNestUnrepresentableError,
    );
  });

  it('accepts an annotated body that also carries a type', () => {
    const named = overrideJSONSchema(
      z.custom<{ a: string }>(() => true),
      binaryFragment,
    ).meta({ id: 'Annotated', title: 'Annotated' });
    // Re-register on the renamed instance — the documented workaround.
    overrideJSONSchema(named, binaryFragment);

    const { refs } = toOpenApi(z.object({ f: named }), { io: 'input', registry });
    expect(refs.get('Annotated')).toMatchObject({ type: 'string', format: 'binary' });
  });

  it('strict: false still emits an unregistered annotation-only body rather than throwing', () => {
    const orphan = z
      .custom<{ a: string }>(() => true)
      .meta({ id: 'LooseAnnotation', title: 'LooseAnnotation' });

    const { refs } = toOpenApi(z.object({ f: orphan }), {
      io: 'input',
      registry,
      strict: false,
    });
    expect(refs.get('LooseAnnotation')).toEqual({ title: 'LooseAnnotation' });
  });
});
