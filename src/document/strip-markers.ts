import type { OpenAPIObject } from '@nestjs/swagger';

import { ZOD_NEST_DTO_EXTENSION } from '../schema/constants.js';

/**
 * Removes `x-zod-nest-dto` placeholder entries from every
 * `components.schemas[K].properties` block. Used as the final cleanup pass
 * after `mergeSchemas` + `rewriteRefs`.
 *
 * In practice the marker has already been overwritten or its key dropped by
 * `mergeSchemas` whenever the DTO is exposed. The straggler case is a
 * registered DTO whose `dtoId === className` AND who was never exposed
 * (no `@Body` reference, no `@ZodResponse`) — `mergeSchemas` leaves the
 * marker in place, this pass strips it.
 *
 * When the marker is the only property, the empty `properties` block is
 * dropped too. The `x-zod-nest-error` extension (engine collision policy)
 * is intentionally preserved so the broken contract stays visible in
 * Swagger UI.
 */
export const stripMarkers = (doc: OpenAPIObject): void => {
  const schemas = doc.components?.schemas;
  if (schemas === undefined) {
    return;
  }
  for (const schema of Object.values(schemas)) {
    stripMarkerFromSchema(schema);
  }
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
