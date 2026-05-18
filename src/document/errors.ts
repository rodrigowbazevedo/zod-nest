import { ZodNestError } from '../schema/errors.js';

export type ZodNestDocumentErrorCode =
  | 'AMBIGUOUS_RENAME'
  | 'DANGLING_REF'
  | 'UNEXPANDABLE_PARAM_DTO';

/**
 * Thrown by `applyZodNest` when the doc cannot be processed cleanly. Surfaces
 * at doc-build time so typos / mis-registrations fail in CI, not at runtime.
 *
 * `AMBIGUOUS_RENAME`: two distinct DTO classes target the same registry id
 * with differing bodies — the rename pass can't write `components.schemas[id]`
 * unambiguously.
 *
 * `DANGLING_REF`: a `$ref` in the doc points at a `components.schemas` key
 * that no longer exists after `applyZodNest`. Usually means a marker was
 * stripped but its rename target wasn't populated, or a user-supplied pre-pass
 * left a stale ref.
 *
 * `UNEXPANDABLE_PARAM_DTO`: a `@Query()` / `@Param()` / `@Headers()` /
 * `@Cookie()` handler argument resolved to a `createZodDto` whose schema is
 * not an object — the marker parameter can't be expanded into individual
 * parameters because there's no top-level `properties` record to iterate.
 */
export class ZodNestDocumentError extends ZodNestError {
  readonly code: ZodNestDocumentErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ZodNestDocumentErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`[zod-nest] ${code}: ${message}`);
    this.name = 'ZodNestDocumentError';
    this.code = code;
    this.details = details;
  }
}
