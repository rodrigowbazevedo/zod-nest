/**
 * Distribute `U` into a contravariant position so TS infers the intersection
 * of all members: `(A & B) | (A & C)` → `A & B & C`.
 *
 * Internal primitive. Consumers should use `AsClassBase` instead — which
 * adds a `never`-safe fallback.
 */
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

/**
 * Coerce `T` into a single object type usable as a class base.
 *
 * `class FooDto extends createZodDto(schema) {}` requires the constructor's
 * return type to be a single object type. TS rejects unions (TS2509), so
 * when `z.infer<TSchema>` is a union — from `z.intersection(obj, union)`,
 * `z.discriminatedUnion`, or bare `z.union` — we collapse it.
 *
 * 1. `UnionToIntersection` folds `(Obj & A) | (Obj & B)` → `Obj & A & B`.
 *    Identity for non-unions, so simple-object DTOs are unaffected.
 * 2. When members are mutually exclusive (discriminated union — a shared
 *    property with conflicting literals), the intersection reduces to
 *    `never`. `never` is itself rejected as a class base, so we fall back
 *    to a permissive index signature.
 *
 * Lossy by design. Use `Dto.parse(input)` to recover the precise inferred
 * type when working with unions.
 */
export type AsClassBase<T> = [UnionToIntersection<T>] extends [never]
  ? Record<string, unknown>
  : UnionToIntersection<T>;
