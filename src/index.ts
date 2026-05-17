export {
  COMPONENTS_SCHEMAS_PREFIX,
  createRegistry,
  defaultRegistry,
  toOpenApi,
  ZOD_NEST_DTO_EXTENSION,
  ZOD_NEST_ERROR_DUPLICATE_ID,
  ZOD_NEST_ERROR_EXTENSION,
  ZodNestError,
  ZodNestUnrepresentableError,
} from './schema/index.js';
export type {
  Override,
  OverrideContext,
  SchemaObject,
  ToOpenApiOptions,
  ToOpenApiResult,
  ZodNestRegistry,
} from './schema/index.js';
export { createZodDto, isZodDtoMarker, makeZodDtoMarker, ZOD_DTO_SYMBOL } from './dto/index.js';
export type { CreateZodDtoOptions, Io, ZodDto, ZodDtoMarker } from './dto/index.js';
