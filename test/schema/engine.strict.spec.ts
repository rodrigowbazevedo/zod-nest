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

  // `.meta()` clones, and `overrideJSONSchema` is instance-keyed, so naming an
  // overridden schema leaves the clone unregistered. It then emits only the
  // metadata Zod wrote — a body with no type, which used to slip past the
  // emptiness check and ship an annotation-only component.
  it('flags a schema whose emitted body is annotation-only', () => {
    const base = overrideJSONSchema(
      z.custom<{ a: string }>(() => true),
      binaryFragment,
    );
    const named = base.meta({ id: 'AnnotationOnly', title: 'AnnotationOnly' });

    expect(() => toOpenApi(z.object({ f: named }), { io: 'input', registry })).toThrow(
      ZodNestUnrepresentableError,
    );
  });

  it('flags an annotation-only body under description alone', () => {
    const base = overrideJSONSchema(
      z.custom<{ a: string }>(() => true),
      binaryFragment,
    );
    const described = base.meta({ id: 'DescribedOnly', description: 'a file' });

    expect(() => toOpenApi(z.object({ f: described }), { io: 'input', registry })).toThrow(
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

  it('strict: false still emits the annotation-only body rather than throwing', () => {
    const base = overrideJSONSchema(
      z.custom<{ a: string }>(() => true),
      binaryFragment,
    );
    const named = base.meta({ id: 'LooseAnnotation', title: 'LooseAnnotation' });

    const { refs } = toOpenApi(z.object({ f: named }), {
      io: 'input',
      registry,
      strict: false,
    });
    expect(refs.get('LooseAnnotation')).toEqual({ title: 'LooseAnnotation' });
  });
});
