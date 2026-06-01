# Engine spec layout — schema shape → target file

The `/schema-fixture` skill uses this mapping to auto-select where a new test case goes. Update when phases add or rename engine specs.

## Specs and their shape signatures

| Spec                                       | What goes here                                                                                                                                          | Shape signal                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `test/schema/engine.primitives.spec.ts`    | One Zod _leaf_ type per case — string, number, boolean, null, bigint, date, literal, enum.                                                              | Snippet is a single `z.X()` call with no chained operators.                                                         |
| `test/schema/engine.modifiers.spec.ts`     | Modifier wrappers on top of any base — `.optional()`, `.nullable()`, `.default()`, `.readonly()`, `.describe()`, `.min()`/`.max()` etc.                 | Snippet chains `.<modifier>(...)` and the modifier is the load-bearing behaviour.                                   |
| `test/schema/engine.composites.spec.ts`    | Composite types — `z.object()`, `z.array()`, `z.tuple()`, `z.record()`, `z.union()`, `z.intersection()`, `z.discriminatedUnion()`, `z.enum()`.          | Snippet contains a composite constructor at its outermost level.                                                    |
| `test/schema/engine.recursion.spec.ts`     | Self- or mutually-recursive schemas via `z.lazy()`.                                                                                                     | Snippet uses `z.lazy()` or references its own const inside the construction.                                        |
| `test/schema/engine.named-refs.spec.ts`    | `.meta({ id })`-named schemas — how the id surfaces in emission, both bare and inside composites.                                                       | Snippet uses `.meta({ id: ... })` (no other registry mechanics).                                                    |
| `test/schema/engine.registry.spec.ts`      | Registry-driven concerns — `createRegistry`, custom-registry isolation, `registry.ids()`, collision behaviour.                                          | Snippet exercises `createRegistry()` directly or asserts on registry state.                                         |
| `test/schema/engine.io-divergence.spec.ts` | Schemas whose input and output JSON Schemas differ — `.transform()`, `.pipe()`, codec-like constructs, `.default()` (input optional → output required). | Snippet contains a transform/pipe/codec, OR the case asserts different outputs for `io: 'input'` vs `io: 'output'`. |
| `test/schema/engine.override.spec.ts`      | Override-callback semantics — user override chain, composition override, built-in primitive overrides.                                                  | Snippet passes `override: ...` to `toOpenApi` or relies on a built-in override.                                     |
| `test/schema/engine.strict.spec.ts`        | `strict: true` mode and `ZodNestUnrepresentableError`.                                                                                                  | Snippet expects an error throw (bigint outside override, transform without `pipe`, etc.).                           |
| `test/schema/engine.build-options.spec.ts` | Internals of `buildToJsonSchemaOptions` — how the option bag is composed across single-schema vs bulk modes.                                            | Snippet asserts on the option bag itself, not the emitted schema. Rare.                                             |
| `test/schema/engine.snapshot.spec.ts`      | Multi-feature composites whose emission is hard to assert in pieces — use Jest snapshot matching instead of `.toEqual()`.                               | User passes `expected: 'snapshot'`, OR the case combines 4+ Zod constructs.                                         |

## Tie-breaker order

When a case fits multiple specs (e.g. a `z.lazy(z.object({...}))` is both recursion and composite), choose in this order — **earlier wins**:

1. `engine.strict.spec.ts` — if the case asserts an error throw, it lives here regardless of shape.
2. `engine.recursion.spec.ts` — recursion dominates when present.
3. `engine.io-divergence.spec.ts` — divergence dominates when present.
4. `engine.override.spec.ts` — override usage dominates when present.
5. `engine.registry.spec.ts` — explicit registry mechanics dominate when present.
6. `engine.named-refs.spec.ts` — `.meta({ id })` without registry mechanics.
7. `engine.composites.spec.ts` — composite root.
8. `engine.modifiers.spec.ts` — modifier on a base.
9. `engine.primitives.spec.ts` — bare leaf type.
10. `engine.snapshot.spec.ts` — fallback for kitchen-sink composites.

## When to update this file

Whenever a phase adds a new `engine.*.spec.ts` file, append a row. Whenever a spec is renamed, retired, or split, update the corresponding cell. `/schema-fixture` reads this file at runtime to pick the target — the skill is only as accurate as the mapping.
