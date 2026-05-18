import type { OpenAPIObject } from '@nestjs/swagger';

import { isZodDtoMarker } from '../dto/marker.js';
import { ZOD_NEST_DTO_EXTENSION } from '../schema/constants.js';
import { forEachOperation } from './http-methods.js';

/**
 * Removes `x-zod-nest-dto` placeholder entries from every
 * `components.schemas[K].properties` block, drops the JSON Schema 2020-12
 * metadata (`$schema`, `$id`) that Zod's bulk emission leaks onto every
 * component body, and removes any stray marker parameter that
 * `expandParamMarkers` left behind. Used as the final cleanup pass after
 * `mergeSchemas` + `expandParamMarkers` + `rewriteRefs`.
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
 * The `$schema` / `$id` strip exists because Zod v4's bulk `toJSONSchema`
 * writes `$schema: "https://json-schema.org/draft/2020-12/schema"` and a
 * relative-URI-fragment `$id` (`#/components/schemas/<Id>`) onto every
 * emitted body. Swagger UI's strict ref resolver chokes on the `$id`
 * fragment — it re-anchors lookups against the leaf schema and then fails
 * to find `components` at the new root. The fields are redundant inside
 * OpenAPI anyway: the schema's identity comes from its `components.schemas`
 * key. We delete both.
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
      dropJsonSchemaMetadata(schema);
    }
  }
  stripMarkerParameters(doc);
};

const dropJsonSchemaMetadata = (schema: unknown): void => {
  if (schema === null || typeof schema !== 'object') {
    return;
  }
  const body = schema as { $schema?: unknown; $id?: unknown };
  delete body.$schema;
  delete body.$id;
};

const stripMarkerParameters = (doc: OpenAPIObject): void => {
  forEachOperation(doc, (op) => {
    const parameters = op.parameters;
    if (!Array.isArray(parameters)) {
      return;
    }
    op.parameters = parameters.filter((param) => !isZodDtoMarker(param));
  });
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
