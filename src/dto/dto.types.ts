import type { z } from 'zod';
import type { ZodNestRegistry } from '../schema/registry.js';
import type { ZOD_DTO_SYMBOL } from './symbols.js';

export type Io = 'input' | 'output';

export interface CreateZodDtoOptions {
  /** Explicit id override. Highest precedence in id resolution. */
  id?: string;
  /** Registry to register this DTO's schema into. Defaults to `defaultRegistry`. */
  registry?: ZodNestRegistry;
  /**
   * Force this DTO's schema into the emitted document even when no endpoint
   * references it. Exposure is otherwise reachability-scoped — a registered
   * schema that no exposed endpoint reaches is pruned. Set `true` to keep an
   * intentionally-documented schema (e.g. for out-of-band client codegen).
   * Defaults to `false`.
   */
  expose?: boolean;
}

/**
 * The class type returned by `createZodDto`. Instance type infers to the
 * Zod output type so handler args typed as the DTO get the inferred shape.
 */
export interface ZodDto<TSchema extends z.ZodType = z.ZodType> {
  new (): z.infer<TSchema>;
  readonly schema: TSchema;
  readonly id: string;
  readonly io: Io;
  readonly Output: ZodDto<TSchema>;
  parse(input: unknown): z.infer<TSchema>;
  safeParse(input: unknown): z.ZodSafeParseResult<z.infer<TSchema>>;
  _OPENAPI_METADATA_FACTORY(): Record<string, unknown>;
  readonly [ZOD_DTO_SYMBOL]: true;
}
