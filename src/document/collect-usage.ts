import type { OpenAPIObject } from '@nestjs/swagger';
import type { ZodNestRegistry } from '../schema/registry.js';

import { isZodDtoMarker } from '../dto/marker.js';
import { COMPONENTS_SCHEMAS_PREFIX, ZOD_NEST_DTO_EXTENSION } from '../schema/constants.js';
import { HTTP_METHODS } from './http-methods.js';
import { walkRefs } from './walk-refs.js';

export interface CollectedUsage {
  /** dtoIds referenced as input via requestBody / parameters `$ref`s in the doc. */
  inputExposedIds: ReadonlySet<string>;
  /** dtoIds referenced as output via `@ZodResponse` on any controller handler. */
  outputExposedIds: ReadonlySet<string>;
  /** Map of `components.schemas` key (NestJS class name) → dtoId from the marker. */
  classToDtoId: ReadonlyMap<string, string>;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Pre-pass over an `applyZodNest` input. Walks the already-built OpenAPI doc
 * for both input-side ids (`requestBody` / `parameters` `$ref`s, plus query /
 * param marker placeholders) and output-side ids (`responses.*.content.*`
 * `$ref`s — `@ZodResponse`'s swagger bridge emits these via `@ApiResponse`, so
 * the document is the source of truth). Walking the document keeps exposure
 * scoped to the endpoints in *this* document — important when several Swagger
 * documents share one registry.
 */
export const collectUsage = (doc: OpenAPIObject, registry: ZodNestRegistry): CollectedUsage => {
  const classToDtoId = buildClassToDtoIdMap(doc);
  const knownIds = new Set(registry.ids());
  const inputExposedIds = collectInputExposedIds(doc, classToDtoId, knownIds);
  const outputExposedIds = collectOutputExposedIds(doc, classToDtoId, knownIds);
  return { inputExposedIds, outputExposedIds, classToDtoId };
};

const buildClassToDtoIdMap = (doc: OpenAPIObject): Map<string, string> => {
  const map = new Map<string, string>();
  const schemas = doc.components?.schemas ?? {};
  for (const [className, schema] of Object.entries(schemas)) {
    const marker = readMarker(schema);
    if (marker === undefined) {
      continue;
    }
    map.set(className, marker.dtoId);
  }
  return map;
};

const readMarker = (schema: unknown): { dtoId: string } | undefined => {
  if (!isPlainRecord(schema)) {
    return undefined;
  }
  if (!isPlainRecord(schema.properties)) {
    return undefined;
  }
  const marker = schema.properties[ZOD_NEST_DTO_EXTENSION];
  if (!isZodDtoMarker(marker)) {
    return undefined;
  }
  return { dtoId: marker.dtoId };
};

const collectInputExposedIds = (
  doc: OpenAPIObject,
  classToDtoId: ReadonlyMap<string, string>,
  knownIds: ReadonlySet<string>,
): Set<string> => {
  const ids = new Set<string>();
  const paths = doc.paths ?? {};
  for (const pathItem of Object.values(paths)) {
    if (!isPlainRecord(pathItem)) {
      continue;
    }
    for (const operation of operationsOf(pathItem)) {
      collectRefsFromOperation(operation, classToDtoId, knownIds, ids);
    }
  }
  return ids;
};

const operationsOf = (pathItem: Record<string, unknown>): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (isPlainRecord(op)) {
      out.push(op);
    }
  }
  return out;
};

const collectRefsFromOperation = (
  operation: Record<string, unknown>,
  classToDtoId: ReadonlyMap<string, string>,
  knownIds: ReadonlySet<string>,
  ids: Set<string>,
): void => {
  // requestBody.content.*.schema.$ref
  if (isPlainRecord(operation.requestBody)) {
    collectRefsFromContent(operation.requestBody.content, classToDtoId, knownIds, ids);
  }
  // parameters[*].schema.$ref AND parameters[*] marker placeholders
  const parameters = operation.parameters;
  if (Array.isArray(parameters)) {
    for (const param of parameters) {
      if (!isPlainRecord(param)) {
        continue;
      }
      collectRefFromSchema(param.schema, classToDtoId, knownIds, ids);
      collectIdFromMarkerParam(param, ids);
    }
  }
};

const collectIdFromMarkerParam = (param: Record<string, unknown>, ids: Set<string>): void => {
  if (param.__zodNestDto !== true) {
    return;
  }
  const dtoId = param.dtoId;
  if (typeof dtoId !== 'string' || dtoId === '') {
    return;
  }
  ids.add(dtoId);
};

const collectRefsFromContent = (
  content: unknown,
  classToDtoId: ReadonlyMap<string, string>,
  knownIds: ReadonlySet<string>,
  ids: Set<string>,
): void => {
  if (!isPlainRecord(content)) {
    return;
  }
  for (const mediaType of Object.values(content)) {
    if (!isPlainRecord(mediaType)) {
      continue;
    }
    collectRefFromSchema(mediaType.schema, classToDtoId, knownIds, ids);
  }
};

const collectRefFromSchema = (
  schema: unknown,
  classToDtoId: ReadonlyMap<string, string>,
  knownIds: ReadonlySet<string>,
  ids: Set<string>,
): void => {
  if (!isPlainRecord(schema)) {
    return;
  }
  // Deep-walk so refs nested inside an inline body (e.g. `@ZodBody` with
  // `flatten: true` emits `{ type: 'object', properties: { p: { $ref } } }`)
  // are seeded too — the closure pass `extendExposureViaRefs` only walks
  // emitted bodies, not inline operation bodies, so it can't pick up
  // nested refs that never lived in `inputSchemas` / `outputSchemas`.
  walkRefs(schema, (ref) => {
    if (!ref.startsWith(COMPONENTS_SCHEMAS_PREFIX)) {
      return undefined;
    }
    const className = ref.slice(COMPONENTS_SCHEMAS_PREFIX.length);
    // Class-DTO refs go through the rename map (NestJS materializes
    // `components.schemas[ClassName]` and the marker says the real dtoId is X).
    // Decorator-emitted refs (`@ZodBody` / `@ZodQuery` / ...) target the id
    // directly with no marker hop — match it against the registry's known ids.
    // Refs to anything else (third-party `@ApiResponse({ schema: { $ref } })`)
    // are left untouched.
    const renamed = classToDtoId.get(className);
    if (renamed !== undefined) {
      ids.add(renamed);
    } else if (knownIds.has(className)) {
      ids.add(className);
    }
    return undefined;
  });
};

const collectOutputExposedIds = (
  doc: OpenAPIObject,
  classToDtoId: ReadonlyMap<string, string>,
  knownIds: ReadonlySet<string>,
): Set<string> => {
  const ids = new Set<string>();
  const paths = doc.paths ?? {};
  for (const pathItem of Object.values(paths)) {
    if (!isPlainRecord(pathItem)) {
      continue;
    }
    for (const operation of operationsOf(pathItem)) {
      collectRefsFromResponses(operation.responses, classToDtoId, knownIds, ids);
    }
  }
  return ids;
};

const collectRefsFromResponses = (
  responses: unknown,
  classToDtoId: ReadonlyMap<string, string>,
  knownIds: ReadonlySet<string>,
  ids: Set<string>,
): void => {
  if (!isPlainRecord(responses)) {
    return;
  }
  for (const response of Object.values(responses)) {
    if (!isPlainRecord(response)) {
      continue;
    }
    collectRefsFromContent(response.content, classToDtoId, knownIds, ids);
  }
};
