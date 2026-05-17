import stringify from 'fast-json-stable-stringify';

import type { OpenAPIObject } from '@nestjs/swagger';
import type { CollectedUsage } from './collect-usage.js';

import { ZOD_NEST_ERROR_DUPLICATE_ID, ZOD_NEST_ERROR_EXTENSION } from '../schema/constants.js';
import { ZodNestDocumentError } from './errors.js';

export interface MergeSchemasParams {
  /** OpenAPI doc whose `components.schemas` will be mutated in place. */
  doc: OpenAPIObject;
  inputSchemas: ReadonlyMap<string, unknown>;
  outputSchemas: ReadonlyMap<string, unknown>;
  collected: CollectedUsage;
  /** Result of `registry.getCollisions()` — ids registered with two or more Zod schemas. */
  collisions: ReadonlyMap<string, ReadonlySet<unknown>>;
}

export interface MergeSchemasResult {
  /** dtoIds whose input and output schemas diverged — output landed at `<id>Output`. */
  divergentOutputIds: ReadonlySet<string>;
  /**
   * `className → dtoId` map for renames where they differ. Commit 5 uses it to
   * rewrite doc-level `$ref`s from `#/components/schemas/<className>` to
   * `#/components/schemas/<dtoId>`.
   */
  renames: ReadonlyMap<string, string>;
}

const OUTPUT_SUFFIX = 'Output';

/**
 * Applies the I/O suffix truth table and class-name → dtoId rename pass to
 * the doc's `components.schemas`. Mutates the doc in place.
 *
 * Truth table per id (in `inputExposedIds ∪ outputExposedIds`):
 * - input-only           → `components.schemas[id] = inputSchemas[id]`
 * - output-only          → `components.schemas[id] = outputSchemas[id]`
 * - both & byte-equal    → write either as `components.schemas[id]`
 * - both & differ        → input as `id`, output as `<id>Output`
 *
 * Rename pass: for every `className → dtoId` mapping from the markers, if
 * `className !== dtoId` and the `className` key still exists in
 * `components.schemas`, delete it. The rename targets (`dtoId`) have already
 * been written by the truth-table step.
 *
 * Collision pass (parity with `engine.ts:62`): for every id in `collisions`,
 * replace its body in `components.schemas` with the duplicate-id error marker
 * so the broken contract is visible in Swagger UI.
 */
export const mergeSchemas = (params: MergeSchemasParams): MergeSchemasResult => {
  const { doc, inputSchemas, outputSchemas, collected, collisions } = params;
  const schemas = ensureComponentsSchemas(doc);
  const renames = new Map<string, string>();
  const divergentOutputIds = new Set<string>();

  const exposedIds = new Set([...collected.inputExposedIds, ...collected.outputExposedIds]);

  for (const id of exposedIds) {
    applyTruthTable(
      schemas,
      id,
      collected.inputExposedIds.has(id),
      collected.outputExposedIds.has(id),
      inputSchemas.get(id),
      outputSchemas.get(id),
      divergentOutputIds,
    );
  }

  for (const [className, dtoId] of collected.classToDtoId) {
    if (className === dtoId) {
      continue;
    }
    renames.set(className, dtoId);
    delete schemas[className];
  }

  applyCollisionDecoration(schemas, collisions, divergentOutputIds);

  return { divergentOutputIds, renames };
};

const ensureComponentsSchemas = (doc: OpenAPIObject): Record<string, unknown> => {
  const components = (doc.components ?? {}) as Record<string, unknown>;
  doc.components = components as OpenAPIObject['components'];
  const schemas = (components.schemas ?? {}) as Record<string, unknown>;
  components.schemas = schemas;
  return schemas;
};

const applyTruthTable = (
  schemas: Record<string, unknown>,
  id: string,
  inputExposed: boolean,
  outputExposed: boolean,
  inputBody: unknown,
  outputBody: unknown,
  divergentOutputIds: Set<string>,
): void => {
  if (inputExposed && !outputExposed) {
    writeOrThrowAmbiguous(schemas, id, inputBody);
    return;
  }
  if (!inputExposed && outputExposed) {
    writeOrThrowAmbiguous(schemas, id, outputBody);
    return;
  }
  // Both exposed.
  if (canonicalEqual(inputBody, outputBody)) {
    writeOrThrowAmbiguous(schemas, id, inputBody);
    return;
  }
  writeOrThrowAmbiguous(schemas, id, inputBody);
  writeOrThrowAmbiguous(schemas, `${id}${OUTPUT_SUFFIX}`, outputBody);
  divergentOutputIds.add(id);
};

const writeOrThrowAmbiguous = (
  schemas: Record<string, unknown>,
  key: string,
  body: unknown,
): void => {
  if (body === undefined) {
    return;
  }
  const existing = schemas[key];
  if (existing === undefined || isMarkerPlaceholder(existing) || canonicalEqual(existing, body)) {
    schemas[key] = body;
    return;
  }
  throw new ZodNestDocumentError(
    'AMBIGUOUS_RENAME',
    `Two distinct schemas target \`components.schemas[${key}]\` with differing bodies — ` +
      'multiple createZodDto classes likely share the same dtoId. Set distinct `options.id` ' +
      'values, or align the class names so renames are unambiguous.',
    { key },
  );
};

const isMarkerPlaceholder = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const properties = (value as { properties?: unknown }).properties;
  if (properties === null || typeof properties !== 'object') {
    return false;
  }
  // `x-zod-nest-dto` is the only marker key Phase 2b adds. If properties has
  // it, the schema body is a NestJS-emitted placeholder we own and can replace.
  return 'x-zod-nest-dto' in (properties as Record<string, unknown>);
};

const canonicalEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return stringify(a) === stringify(b);
};

const applyCollisionDecoration = (
  schemas: Record<string, unknown>,
  collisions: ReadonlyMap<string, ReadonlySet<unknown>>,
  divergentOutputIds: ReadonlySet<string>,
): void => {
  for (const [id] of collisions) {
    decorateIfPresent(schemas, id);
    if (divergentOutputIds.has(id)) {
      decorateIfPresent(schemas, `${id}${OUTPUT_SUFFIX}`);
    }
  }
};

const decorateIfPresent = (schemas: Record<string, unknown>, key: string): void => {
  if (!(key in schemas)) {
    return;
  }
  schemas[key] = {
    description: `ERROR: duplicate zod-nest id <${key.replace(/Output$/, '')}>`,
    [ZOD_NEST_ERROR_EXTENSION]: ZOD_NEST_ERROR_DUPLICATE_ID,
  };
};
