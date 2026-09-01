import type { SchemaObject } from '../../src/schema/openapi.types.js';

// Zod 4.4 spells unions/intersections `anyOf`/`allOf`; 4.5 uses a type array and
// a merged object. Assert the semantics both spellings share.

export const expectUnionOf = (schema: SchemaObject, types: readonly string[]): void => {
  if (Array.isArray(schema.type)) {
    expect(schema.type).toEqual([...types]);
    return;
  }
  expect(schema.anyOf).toEqual(types.map((type) => ({ type })));
};

export const expectIntersectionOf = (
  schema: SchemaObject,
  propertyNames: readonly string[],
): void => {
  const arms = Array.isArray(schema.allOf) ? schema.allOf : [schema];
  const emitted = arms.flatMap((arm) => Object.keys(arm.properties ?? {}));

  expect([...new Set(emitted)].sort()).toEqual([...propertyNames].sort());
};
