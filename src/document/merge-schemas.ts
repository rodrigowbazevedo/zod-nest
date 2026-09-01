import stringify from 'fast-json-stable-stringify';

import type { OpenAPIObject } from '@nestjs/swagger';
import type { CollectedUsage } from './collect-usage.js';

import { isZodDtoMarker } from '../dto/marker.js';
import {
  ZOD_NEST_DTO_EXTENSION,
  ZOD_NEST_ERROR_DUPLICATE_ID,
  ZOD_NEST_ERROR_EXTENSION,
} from '../schema/constants.js';
import { OUTPUT_SUFFIX } from './constants.js';
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
  /** `className → dtoId` map for renames where they differ. */
  renames: ReadonlyMap<string, string>;
}

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
  // Snapshot before any write, so a conflict can tell a body that was already
  // in the doc (Nest's native Standard Schema converter, a hand-authored
  // component, a pre-pass) from one zod-nest emitted earlier in this loop.
  const foreignKeys = collectForeignKeys(schemas);

  for (const id of exposedIds) {
    applyTruthTable({
      schemas,
      id,
      inputExposed: collected.inputExposedIds.has(id),
      outputExposed: collected.outputExposedIds.has(id),
      inputBody: inputSchemas.get(id),
      outputBody: outputSchemas.get(id),
      divergentOutputIds,
      foreignKeys,
    });
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

interface ApplyTruthTableParams {
  schemas: Record<string, unknown>;
  id: string;
  inputExposed: boolean;
  outputExposed: boolean;
  inputBody: unknown;
  outputBody: unknown;
  divergentOutputIds: Set<string>;
  foreignKeys: ReadonlySet<string>;
}

const applyTruthTable = (params: ApplyTruthTableParams): void => {
  const { schemas, id, inputExposed, outputExposed, inputBody, outputBody } = params;
  const { divergentOutputIds, foreignKeys } = params;
  if (inputExposed && !outputExposed) {
    writeOrThrowAmbiguous(schemas, id, inputBody, foreignKeys);
    return;
  }
  if (!inputExposed && outputExposed) {
    writeOrThrowAmbiguous(schemas, id, outputBody, foreignKeys);
    return;
  }
  // Both exposed.
  if (canonicalEqual(inputBody, outputBody)) {
    writeOrThrowAmbiguous(schemas, id, inputBody, foreignKeys);
    return;
  }
  writeOrThrowAmbiguous(schemas, id, inputBody, foreignKeys);
  writeOrThrowAmbiguous(schemas, `${id}${OUTPUT_SUFFIX}`, outputBody, foreignKeys);
  divergentOutputIds.add(id);
};

const collectForeignKeys = (schemas: Record<string, unknown>): ReadonlySet<string> => {
  const foreign = new Set<string>();
  for (const [key, body] of Object.entries(schemas)) {
    if (!isMarkerPlaceholder(body)) {
      foreign.add(key);
    }
  }
  return foreign;
};

const writeOrThrowAmbiguous = (
  schemas: Record<string, unknown>,
  key: string,
  body: unknown,
  foreignKeys: ReadonlySet<string>,
): void => {
  if (body === undefined) {
    return;
  }
  const existing = schemas[key];
  if (existing === undefined || isMarkerPlaceholder(existing) || canonicalEqual(existing, body)) {
    schemas[key] = body;
    return;
  }
  const preexisting = foreignKeys.has(key);
  throw new ZodNestDocumentError(
    'AMBIGUOUS_RENAME',
    `Two distinct schemas target \`components.schemas[${key}]\` with differing bodies — ` +
      ambiguousRenameHint(key, preexisting),
    { key, preexisting },
  );
};

const ambiguousRenameHint = (key: string, preexisting: boolean): string => {
  if (preexisting) {
    return (
      `\`${key}\` was already populated before zod-nest emitted anything. On NestJS 12+ the ` +
      'usual cause is the native Standard Schema path — `@Body({ schema })`, `@Query({ schema })` ' +
      'or `@ApiResponse({ standardSchema })` — which makes @nestjs/swagger emit the component ' +
      'itself, in its OpenAPI 3.0 shape. Route the schema through `createZodDto` / `@ZodBody` / ' +
      '`@ZodResponse` instead, or drop `applyZodNest` and let Nest own the whole document. ' +
      'A hand-authored component or a doc pre-pass under the same name does this too.'
    );
  }
  return (
    'Two registered ids resolved to the same key — most often an `<Id>Output` sibling from a ' +
    'diverging input/output schema colliding with a DTO explicitly registered as `<Id>Output`. ' +
    'Rename one of them, or set a distinct `options.id`.'
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
  const marker = (properties as Record<string, unknown>)[ZOD_NEST_DTO_EXTENSION];
  return isZodDtoMarker(marker);
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
