/** OpenAPI 3.1 `$ref` prefix for entries in `components.schemas`. */
export const COMPONENTS_SCHEMAS_PREFIX = '#/components/schemas/';

/** OpenAPI extension key zod-nest uses to surface engine errors inside emitted schemas. */
export const ZOD_NEST_ERROR_EXTENSION = 'x-zod-nest-error';

/** Value of `x-zod-nest-error` when a registry id is claimed by more than one schema. */
export const ZOD_NEST_ERROR_DUPLICATE_ID = 'duplicate-id';

/**
 * OpenAPI extension key used by `createZodDto` to mark a class for Phase 2e's
 * doc-merger. The marker carries `{ __zodNestDto: true, dtoId, io }` so the
 * merger can locate every zod-nest DTO in the @nestjs/swagger document and
 * inject the real Zod-derived schema.
 */
export const ZOD_NEST_DTO_EXTENSION = 'x-zod-nest-dto';
