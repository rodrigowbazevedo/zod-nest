/**
 * Runtime detection marker placed on every class returned by `createZodDto`.
 * Used by the validation pipe (Phase 2c), serializer (2d), and doc merger (2e)
 * to discriminate zod-nest DTO classes from regular constructors.
 */
export const ZOD_DTO_SYMBOL: unique symbol = Symbol.for('zod-nest.dto');
