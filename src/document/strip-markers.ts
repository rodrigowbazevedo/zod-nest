import type { OpenAPIObject } from '@nestjs/swagger';

import { ZOD_NEST_DTO_EXTENSION } from '../schema/constants.js';
import { HTTP_METHODS } from './http-methods.js';

/**
 * Removes `x-zod-nest-dto` placeholder entries from every
 * `components.schemas[K].properties` block, plus any stray marker parameter
 * that `expandParamMarkers` left behind. Used as the final cleanup pass
 * after `mergeSchemas` + `expandParamMarkers` + `rewriteRefs`.
 *
 * In practice the schema marker has already been overwritten or its key
 * dropped by `mergeSchemas` whenever the DTO is exposed. The straggler case
 * is a registered DTO whose `dtoId === className` AND who was never exposed
 * (no `@Body` reference, no `@ZodResponse`) — `mergeSchemas` leaves the
 * marker in place, this pass strips it.
 *
 * The parameter strip is belt-and-braces — `expandParamMarkers` already
 * removes the marker placeholders by replacing them with expanded entries.
 * This pass catches anything that somehow slipped through (e.g. a future
 * caller that bypasses `applyZodNest`'s pipeline).
 *
 * When the marker is the only property, the empty `properties` block is
 * dropped too. The `x-zod-nest-error` extension (engine collision policy)
 * is intentionally preserved so the broken contract stays visible in
 * Swagger UI.
 */
export const stripMarkers = (doc: OpenAPIObject): void => {
  const schemas = doc.components?.schemas;
  if (schemas !== undefined) {
    for (const schema of Object.values(schemas)) {
      stripMarkerFromSchema(schema);
    }
  }
  stripMarkerParameters(doc);
};

const stripMarkerParameters = (doc: OpenAPIObject): void => {
  const paths = doc.paths;
  if (paths === null || typeof paths !== 'object') {
    return;
  }
  for (const pathItem of Object.values(paths)) {
    if (pathItem === null || typeof pathItem !== 'object') {
      continue;
    }
    const pathRecord = pathItem as Record<string, unknown>;
    for (const method of HTTP_METHODS) {
      const op = pathRecord[method];
      if (op === null || typeof op !== 'object') {
        continue;
      }
      const opRecord = op as Record<string, unknown>;
      const parameters = opRecord.parameters;
      if (!Array.isArray(parameters)) {
        continue;
      }
      opRecord.parameters = parameters.filter((param) => !isMarkerParam(param));
    }
  }
};

const isMarkerParam = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return (value as { __zodNestDto?: unknown }).__zodNestDto === true;
};

const stripMarkerFromSchema = (schema: unknown): void => {
  if (schema === null || typeof schema !== 'object') {
    return;
  }
  const properties = (schema as { properties?: unknown }).properties;
  if (properties === null || typeof properties !== 'object') {
    return;
  }
  const props = properties as Record<string, unknown>;
  if (!(ZOD_NEST_DTO_EXTENSION in props)) {
    return;
  }
  delete props[ZOD_NEST_DTO_EXTENSION];
  if (Object.keys(props).length === 0) {
    delete (schema as { properties?: unknown }).properties;
  }
};
