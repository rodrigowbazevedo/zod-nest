import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { SchemaObject } from '../../src/schema/openapi.types.js';

import { applyZodNest } from '../../src/document/index.js';
import { createZodDto } from '../../src/dto/index.js';
import { overrideJSONSchema, ZodNestUnrepresentableError } from '../../src/index.js';
import { findIdOwner, findRefTarget } from '../../src/schema/clone-chain.js';
import { toOpenApi } from '../../src/schema/engine.js';
import { createRegistry, registerSchema } from '../../src/schema/registry.js';

const supportsCompile = typeof z.compile === 'function';

const buildDoc = (dtoId: string) => ({
  openapi: '3.1.0',
  info: { title: 't', version: '1' },
  paths: {
    '/x': {
      get: {
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${dtoId}` } } },
          },
        },
      },
    },
  },
});

const emitNested = (inner: z.ZodType, outerId: string): Record<string, SchemaObject> => {
  const registry = createRegistry();
  const Outer = z.object({ inner }).meta({ id: outerId });
  const Dto = createZodDto(Outer, { registry });
  const doc = applyZodNest(buildDoc(Dto.id), { registry });
  return (doc.components?.schemas ?? {}) as Record<string, SchemaObject>;
};

type AnnotationClone = [label: string, clone: (base: z.ZodObject) => z.ZodType];

const compileClone: AnnotationClone[] = supportsCompile
  ? [['z.compile()', (base) => z.compile(base)]]
  : [];

const annotationClones: AnnotationClone[] = [
  ['.describe()', (base) => base.describe('a base')],
  ['.refine()', (base) => base.refine(() => true)],
  ['.meta() alias', (base) => base.meta({ title: 'Aliased' })],
  ...compileClone,
];

describe('clone chain — document dependencies', () => {
  it.each(annotationClones)(
    'resolves the $ref a %s clone emits to its named ancestor',
    (label, clone) => {
      const outerId = `DR_Outer_${label.replace(/\W/g, '')}`;
      const baseId = `DR_Base_${label.replace(/\W/g, '')}`;
      const Base = z.object({ a: z.string() }).meta({ id: baseId });

      const schemas = emitNested(clone(Base), outerId);

      // A clone may carry its own annotation alongside the `$ref` (`.describe()`
      // emits `description`, `.meta({ title })` emits `title`) — both are correct.
      expect(schemas[baseId]).toMatchObject({ type: 'object' });
      expect(schemas[outerId]?.properties?.inner).toMatchObject({
        $ref: `#/components/schemas/${baseId}`,
      });
    },
  );

  it('still emits a plainly nested named schema', () => {
    const Base = z.object({ a: z.string() }).meta({ id: 'DR_Plain_Base' });
    const schemas = emitNested(Base, 'DR_Plain_Outer');
    expect(schemas.DR_Plain_Base).toBeDefined();
  });
});

describe('clone chain — id adoption', () => {
  it.skipIf(!supportsCompile)('keeps the id of a compiled DTO schema', () => {
    const registry = createRegistry();
    const User = z.object({ id: z.string() }).meta({ id: 'CC_User' });
    expect(createZodDto(z.compile(User), { registry }).id).toBe('CC_User');
  });

  it.skipIf(!supportsCompile)('does not collide two compiled DTOs onto one fallback id', () => {
    const registry = createRegistry();
    const User = z.object({ id: z.string() }).meta({ id: 'CC_ColUser' });
    const Order = z.object({ total: z.number() }).meta({ id: 'CC_ColOrder' });

    const UserDto = createZodDto(z.compile(User), { registry });
    const OrderDto = createZodDto(z.compile(Order), { registry });

    expect(UserDto.id).toBe('CC_ColUser');
    expect(OrderDto.id).toBe('CC_ColOrder');
    expect(registry.hasCollision('CC_ColUser')).toBe(false);
  });

  it.skipIf(!supportsCompile)(
    'registers the owner, not the clone, so no false collision is reported',
    () => {
      const registry = createRegistry();
      const Base = z.object({ a: z.string() }).meta({ id: 'CC_Owner' });
      registerSchema(Base, registry);
      registerSchema(z.compile(Base), registry);
      expect(registry.hasCollision('CC_Owner')).toBe(false);
    },
  );
});

describe('clone chain — overrideJSONSchema fragments', () => {
  const binary = { type: 'string', format: 'binary' } as const;

  const emitField = (field: z.ZodType) =>
    toOpenApi(z.object({ f: field }), { registry: createRegistry(), io: 'input', strict: true })
      .schema.properties?.f;

  it('inherits the fragment through an annotation clone', () => {
    const File = overrideJSONSchema(
      z.custom<Blob>(() => true),
      binary,
    );
    expect(emitField(File.describe('an upload'))).toMatchObject({
      type: 'string',
      format: 'binary',
      description: 'an upload',
    });
  });

  it('keeps a transform pipe fragment through .describe() — the bff shape', () => {
    const IsoDatetimeFlexible = overrideJSONSchema(
      z
        .string()
        .transform((value) => value.replace(' ', 'T'))
        .pipe(z.iso.datetime({ local: true, offset: true })),
      { type: 'string', format: 'date-time' },
    );

    expect(emitField(IsoDatetimeFlexible.describe('Start date'))).toEqual({
      type: 'string',
      format: 'date-time',
      description: 'Start date',
    });
  });

  it('does not inherit the fragment through a constraint clone', () => {
    const File = overrideJSONSchema(
      z.custom<Blob>(() => true),
      binary,
    );
    expect(() => emitField(File.refine(() => true))).toThrow(ZodNestUnrepresentableError);
  });

  it('leaves an inherited fragment off a body Zod already resolved to a $ref', () => {
    const registry = createRegistry();
    const base = overrideJSONSchema(
      z.custom<Blob>(() => true),
      binary,
    );
    const named = base.meta({ id: 'CC_RefGuard' });
    const alias = named.describe('an alias');

    const { refs, schema } = toOpenApi(z.object({ f: alias }), { registry, io: 'input' });

    expect(refs.get('CC_RefGuard')).toMatchObject(binary);
    expect(schema.properties?.f).toMatchObject({
      $ref: expect.stringContaining('CC_RefGuard'),
    });
  });

  it('leaves a $ref use site alone rather than inlining an inherited fragment', () => {
    const registry = createRegistry();
    const File = overrideJSONSchema(
      z.custom<Blob>(() => true),
      binary,
    );
    const Named = File.meta({ id: 'CC_NamedUpload' });

    const { refs, schema } = toOpenApi(z.object({ a: Named, b: Named }), {
      registry,
      io: 'input',
    });

    expect(refs.get('CC_NamedUpload')).toMatchObject(binary);
    expect(schema.properties?.a).toMatchObject({ $ref: expect.stringContaining('CC_NamedUpload') });
  });
});

describe('clone chain — constraint clones must not adopt', () => {
  it('keeps a constrained clone as its own component with its constraint', () => {
    const registry = createRegistry();
    const Name = z.object({ v: z.string() }).meta({ id: 'CC_Name' });
    const Dto = createZodDto(Name.extend({ v: z.string().min(3) }), { registry, id: 'CC_Short' });

    const emitted = toOpenApi(Dto.schema, { registry, io: 'input' }).schema;

    expect(Dto.id).toBe('CC_Short');
    expect(emitted.properties?.v).toMatchObject({ minLength: 3 });
  });

  it('does not adopt an ancestor id across a .refine() clone', () => {
    const Base = z.object({ a: z.string() }).meta({ id: 'CC_RefineBase' });
    expect(findIdOwner(Base.refine(() => true))).toBeUndefined();
    expect(findRefTarget(Base.refine(() => true))?.id).toBe('CC_RefineBase');
  });

  it('does not adopt an ancestor id across a constraint clone', () => {
    const Named = z.string().meta({ id: 'CC_Constrained' });
    expect(findIdOwner(Named.min(3))).toBeUndefined();
  });

  it('adopts across def-identical clones only', () => {
    const Base = z.object({ a: z.string() }).meta({ id: 'CC_DefShared' });
    if (supportsCompile) {
      expect(findIdOwner(z.compile(Base))?.id).toBe('CC_DefShared');
    }
    expect(findIdOwner(Base.describe('d'))?.id).toBe('CC_DefShared');
    expect(findIdOwner(Base.describe('d'))?.owner).toBe(Base);
  });

  it('never inherits across structural derivations', () => {
    const Base = z.object({ a: z.string(), b: z.string() }).meta({ id: 'CC_Structural' });
    expect(findIdOwner(Base.extend({ c: z.string() }))).toBeUndefined();
    expect(findIdOwner(Base.partial())).toBeUndefined();
    expect(findIdOwner(Base.pick({ a: true }))).toBeUndefined();
    expect(findIdOwner(Base.optional())).toBeUndefined();
    expect(findRefTarget(Base.extend({ c: z.string() }))).toBeUndefined();
  });

  it('returns undefined for an anonymous chain', () => {
    expect(findIdOwner(z.string().describe('x'))).toBeUndefined();
    expect(findRefTarget(z.string().min(1))).toBeUndefined();
  });
});
