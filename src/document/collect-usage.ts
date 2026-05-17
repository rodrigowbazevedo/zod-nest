import { DiscoveryService } from '@nestjs/core';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { ResponseVariant } from '../response/metadata.js';

import { isZodDtoMarker } from '../dto/marker.js';
import { isZodDto } from '../dto/predicates.js';
import { getResponseVariants } from '../response/metadata.js';
import { COMPONENTS_SCHEMAS_PREFIX, ZOD_NEST_DTO_EXTENSION } from '../schema/constants.js';
import { HTTP_METHODS } from './http-methods.js';

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
 * for input-side ids (reliable — `@nestjs/swagger` materializes
 * `requestBody`/`parameters` schemas with `$ref`s back to `components.schemas`
 * entries) and walks the NestJS app's controller graph via `DiscoveryService`
 * for output-side ids (`@nestjs/swagger` is currently anemic on response
 * shapes — the source of truth lives in `@ZodResponse` metadata).
 */
export const collectUsage = (doc: OpenAPIObject, app: INestApplication): CollectedUsage => {
  const classToDtoId = buildClassToDtoIdMap(doc);
  const inputExposedIds = collectInputExposedIds(doc, classToDtoId);
  const outputExposedIds = collectOutputExposedIds(app);
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
): Set<string> => {
  const ids = new Set<string>();
  const paths = doc.paths ?? {};
  for (const pathItem of Object.values(paths)) {
    if (!isPlainRecord(pathItem)) {
      continue;
    }
    for (const operation of operationsOf(pathItem)) {
      collectRefsFromOperation(operation, classToDtoId, ids);
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
  ids: Set<string>,
): void => {
  // requestBody.content.*.schema.$ref
  if (isPlainRecord(operation.requestBody)) {
    collectRefsFromContent(operation.requestBody.content, classToDtoId, ids);
  }
  // parameters[*].schema.$ref
  const parameters = operation.parameters;
  if (Array.isArray(parameters)) {
    for (const param of parameters) {
      if (!isPlainRecord(param)) {
        continue;
      }
      collectRefFromSchema(param.schema, classToDtoId, ids);
    }
  }
};

const collectRefsFromContent = (
  content: unknown,
  classToDtoId: ReadonlyMap<string, string>,
  ids: Set<string>,
): void => {
  if (!isPlainRecord(content)) {
    return;
  }
  for (const mediaType of Object.values(content)) {
    if (!isPlainRecord(mediaType)) {
      continue;
    }
    collectRefFromSchema(mediaType.schema, classToDtoId, ids);
  }
};

const collectRefFromSchema = (
  schema: unknown,
  classToDtoId: ReadonlyMap<string, string>,
  ids: Set<string>,
): void => {
  if (!isPlainRecord(schema)) {
    return;
  }
  const ref = schema.$ref;
  if (typeof ref !== 'string' || !ref.startsWith(COMPONENTS_SCHEMAS_PREFIX)) {
    return;
  }
  const className = ref.slice(COMPONENTS_SCHEMAS_PREFIX.length);
  const dtoId = classToDtoId.get(className);
  if (dtoId !== undefined) {
    ids.add(dtoId);
  }
};

const collectOutputExposedIds = (app: INestApplication): Set<string> => {
  const ids = new Set<string>();
  const discovery = app.get(DiscoveryService);
  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as object | null | undefined;
    if (instance === null || instance === undefined) {
      continue;
    }
    // `Object.getPrototypeOf(instance)` only returns null when called on a
    // null-prototype object (`Object.create(null)`). NestJS controllers are
    // always class instances, so the prototype is always a real object.
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const methodName of Object.getOwnPropertyNames(proto)) {
      if (methodName === 'constructor') {
        continue;
      }
      const handler = proto[methodName];
      if (typeof handler !== 'function') {
        continue;
      }
      const variants = getResponseVariants(handler);
      if (variants === undefined) {
        continue;
      }
      for (const variant of variants) {
        addVariantDtoIds(variant, ids);
      }
    }
  }
  return ids;
};

const addVariantDtoIds = (variant: ResponseVariant, ids: Set<string>): void => {
  if (variant.kind === 'single') {
    if (isZodDto(variant.dto)) {
      ids.add(variant.dto.id);
    }
    return;
  }
  if (!Array.isArray(variant.dto)) {
    return;
  }
  for (const dto of variant.dto) {
    if (isZodDto(dto)) {
      ids.add(dto.id);
    }
  }
};
