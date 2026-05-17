/** OpenAPI 3.1 `$ref` prefix for entries in `components.schemas`. */
export const COMPONENTS_SCHEMAS_PREFIX = '#/components/schemas/';

/** OpenAPI extension key zod-nest uses to surface engine errors inside emitted schemas. */
export const ZOD_NEST_ERROR_EXTENSION = 'x-zod-nest-error';

/** Value of `x-zod-nest-error` when a registry id is claimed by more than one schema. */
export const ZOD_NEST_ERROR_DUPLICATE_ID = 'duplicate-id';
