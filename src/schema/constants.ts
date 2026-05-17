/** OpenAPI 3.1 `$ref` prefix for entries in `components.schemas`. */
export const COMPONENTS_SCHEMAS_PREFIX = '#/components/schemas/';

/** JSON Schema `$ref` prefix for entries in `$defs` (single-schema emission). */
export const DEFS_PREFIX = '#/$defs/';

/** OpenAPI extension key zod-nest uses to surface engine errors inside emitted schemas. */
export const ZOD_NEST_ERROR_EXTENSION = 'x-zod-nest-error';

/** Value of `x-zod-nest-error` when a registry id is claimed by more than one schema. */
export const ZOD_NEST_ERROR_DUPLICATE_ID = 'duplicate-id';

/**
 * OpenAPI extension key used by `createZodDto` to mark a class for `applyZodNest`.
 * The marker carries `{ __zodNestDto: true, dtoId, io }` so `applyZodNest` can
 * locate every zod-nest DTO in the @nestjs/swagger document and inject the
 * real Zod-derived schema.
 */
export const ZOD_NEST_DTO_EXTENSION = 'x-zod-nest-dto';
