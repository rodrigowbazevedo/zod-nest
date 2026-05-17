import type { Io } from './dto.types.js';

/**
 * Payload of the `x-zod-nest-dto` placeholder property that
 * `_OPENAPI_METADATA_FACTORY` returns. `applyZodNest` reads this off
 * each `components.schemas.<DtoName>.properties[x-zod-nest-dto]` entry,
 * uses `dtoId` to look up the schema in the registry, and replaces the
 * synthetic schema body with the real Zod-derived schema.
 *
 * `type` and `required` are benign filler that satisfy @nestjs/swagger's
 * property-type guard (without them, the explorer throws "A circular
 * dependency has been detected"). They have no semantic meaning and are
 * stripped along with the rest of the marker by `applyZodNest`.
 */
export interface ZodDtoMarker {
  readonly type: () => typeof Object;
  readonly required: false;
  readonly __zodNestDto: true;
  readonly dtoId: string;
  readonly io: Io;
}

export const makeZodDtoMarker = (dtoId: string, io: Io): ZodDtoMarker => ({
  type: () => Object,
  required: false,
  __zodNestDto: true,
  dtoId,
  io,
});

export const isZodDtoMarker = (value: unknown): value is ZodDtoMarker => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return (value as { __zodNestDto?: unknown }).__zodNestDto === true;
};
