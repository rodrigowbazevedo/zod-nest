# Zod knowledge map

Reference for `/scan-zod-features`. Lists the Zod APIs zod-nest depends on, where they live in the installed package, and what to watch for.

## Watched APIs

### `z.toJSONSchema(schema, options)`

The core integration point. We call this in two modes:

1. **Single-schema** — `src/schema/engine.ts:toOpenApi` for individual schemas (e.g. fixture tests).
2. **Bulk** — `src/document/bulk-emit.ts:bulkEmit` for the whole registry, called by `applyZodNest`.

Both paths share option construction via `buildToJsonSchemaOptions` (`src/schema/engine.ts`).

### Options we pass

| Key | Value we pass | Why |
|---|---|---|
| `target` | `'openapi-3.1'` | OpenAPI 3.1 emission rules. Locked. |
| `metadata` | `registry.zodRegistry` | Use our registry's underlying `z.registry` for `.meta()` lookups. |
| `io` | `'input'` or `'output'` | Drives the I/O suffix decision. Bulk mode runs both. |
| `override` | composition + primitive chain | `createCompositionOverride` + `primitiveOverride` composed user override. |
| `uri` | bulk mode only | Shapes registered-schema `$ref`s to `#/components/schemas/<id>` directly, skipping post-process rewrite. |
| `cycles` | `'ref'` | Self-recursive schemas resolve via `$ref` cycle back to root. |
| `reused` | `'inline'` | Anonymous reused branches inline rather than extracting to a virtual `__shared/$defs`. |
| `unrepresentable` | strict mode → `'throw'`; else → `'any'` | Maps to `ZodNestUnrepresentableError` vs emit-as-`{}`. |

### `.meta({ ... })`

JSON Schema annotations flow through to the OpenAPI doc. We rely on:

- `id` — load-bearing for the DTO bridge (`createZodDto` reads it via `resolveId`).
- `title`, `description`, `examples`, `deprecated` — Swagger UI rendering.
- Custom keys — pass through unchanged.

### `z.registry()` and `z.globalRegistry`

Our `createRegistry()` (`src/schema/registry.ts`) wraps `z.globalRegistry` rather than minting an isolated registry. `bulkEmit` filters output against our snapshot ids since global may hold third-party entries.

### `Override` and `OverrideContext`

The override callback shape. Our compositions:

- `createCompositionOverride` (`src/schema/composition.ts`) — emits `allOf` for `extend`-derived schemas.
- `primitiveOverride` (`src/schema/override.ts`) — bigint/date/symbol/transform → representable forms.

Both destructure `{ zodSchema, jsonSchema }` from `OverrideContext`. Mutate `jsonSchema` in place; reassigning `ctx.jsonSchema = newBody` doesn't propagate.

## Source-of-truth paths

Inside `node_modules/zod/dist/types/v4/core/`:

| Concern | File |
|---|---|
| `toJSONSchema` function + options type | `to-json-schema.d.ts` |
| `z.registry()` + global registry shape | `registries.d.ts` |
| `.meta()` semantics + type | `meta.d.ts` |
| Internal processors the override hook integrates with | `json-schema-processors.d.ts` |

If the layout shifts (Zod has restructured `dist/` in past minors), fall back to globbing: `grep -rln "function toJSONSchema" node_modules/zod/`.

Upstream source (for reading the implementation when `.d.ts` isn't enough):

- Repo: [`colinhacks/zod`](https://github.com/colinhacks/zod).
- Source: `packages/zod/src/v4/core/to-json-schema.ts`, `json-schema-processors.ts`, `registries.ts`, `meta.ts`.

## Known historical churn

Patterns that have moved in past Zod releases — keep an eye on these:

- **`id` extraction from `$defs`** — Zod 4.4 stripped `id` from `$defs` entries; we now compute final ids via `title || id` heuristic. If 4.x reverts or changes this, our id mapping needs to re-stabilise.
- **`unrepresentable` semantics** — the `'any'` value means "emit `{}` and proceed"; `'throw'` raises. Some early v4 releases used different enum values. Verify on every minor.
- **`uri` callback shape** — accepts the schema id, returns the ref string. We call it as `(id) => '#/components/schemas/' + id` in bulk mode. The signature is stable but worth verifying.

## When to update this file

- Zod's `.d.ts` layout changes — update the source-of-truth paths table.
- We start passing a new option to `toJSONSchema` — add a row to the Options table.
- We drop reliance on a watched API — remove its row (history lives in git).
- A historical-churn pattern is fully resolved (Zod commits to the current shape via a major release) — remove from the churn list.
