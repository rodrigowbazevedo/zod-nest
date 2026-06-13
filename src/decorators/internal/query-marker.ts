/**
 * `@nestjs/swagger`'s metadata key for explicit operation parameters — the
 * array `@ApiQuery` / `@ApiParam` / etc. append to. Hardcoded because the
 * `DECORATORS` constant that owns it (`DECORATORS.API_PARAMETERS`) is not
 * re-exported from the package's public barrel. The end-to-end smoke test
 * (`test/decorators/zod-decorators.swagger-smoke.spec.ts`) guards the contract.
 */
const API_PARAMETERS_METADATA_KEY = 'swagger/apiParameters';

/**
 * Append a single zod-nest query marker to a handler's swagger parameter
 * metadata — the same `{ __zodNestDto, dtoId, io, in }` placeholder shape that
 * `createZodDto`'s `_OPENAPI_METADATA_FACTORY` produces for `@Query() dto`, so
 * `expandParamMarkers` resolves it through one code path. Deferring (rather
 * than expanding at decoration time) is what lets `@ZodQuery`'s ref decision
 * follow `applyZodNest`'s `queryParamStyle` preference, which isn't known until
 * the document is built.
 *
 * `type` is intentionally omitted: `@nestjs/swagger`'s `SchemaObjectFactory`
 * returns a typeless query parameter untouched, so the marker (and its custom
 * keys) survives `SwaggerModule.createDocument` verbatim for `expandParamMarkers`
 * to read. `name` is set to `dtoId` purely to give the placeholder a stable
 * identity before expansion replaces it.
 *
 * @param dtoId Registered component id of the query DTO schema.
 * @param ref Per-marker override of `queryParamStyle`; omitted from the marker
 *   when `undefined` so the global preference applies.
 */
export const appendQueryMarker =
  (dtoId: string, ref: boolean | undefined): MethodDecorator =>
  (_target, _propertyKey, descriptor) => {
    const method = descriptor.value;
    if (typeof method !== 'function') {
      return descriptor;
    }
    const marker: Record<string, unknown> = {
      name: dtoId,
      in: 'query',
      __zodNestDto: true,
      dtoId,
      io: 'input',
    };
    if (ref !== undefined) {
      marker.ref = ref;
    }
    const existing: unknown = Reflect.getMetadata(API_PARAMETERS_METADATA_KEY, method);
    const params: unknown[] = Array.isArray(existing) ? existing : [];
    Reflect.defineMetadata(API_PARAMETERS_METADATA_KEY, [...params, marker], method);
    return descriptor;
  };
