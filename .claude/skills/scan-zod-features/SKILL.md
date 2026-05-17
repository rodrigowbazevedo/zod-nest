---
name: scan-zod-features
description: >
  Surface scanner for the Zod v4 → JSON Schema API that zod-nest consumes (`z.toJSONSchema`, `.meta()`, registries, override hook). Reads the installed `node_modules/zod/dist/.../core/to-json-schema.d.ts` (or the source `.ts` when available) and diffs it against what `src/schema/engine.ts` actually uses. Surfaces breaking shape changes, removed options, new options we don't pass through, and renamed APIs. Use whenever Zod is bumped, when `/check-upstream-updates` invokes it as part of the `zod` target, or when the user wants to verify the integration is still aligned with the upstream API. Reports inline; the orchestrator weaves the findings into the larger upstream report.
---

# scan-zod-features

Source-aware scanner for the Zod surface zod-nest depends on. Narrower than `/check-upstream-updates` — focuses only on the `toJSONSchema` + metadata + override pipeline, since that's the load-bearing integration point.

## When to invoke

- **As part of `/check-upstream-updates --target zod|all`.** The orchestrator hands off; this skill returns findings.
- **Standalone after a Zod minor or major bump.** Quick sanity check that nothing we consume changed shape.
- **When debugging a Zod-related issue** — e.g. a schema's emission changed unexpectedly. The scanner shows what's available in the installed version vs what we use.

## Inputs

Optional:
- `--baseline <version>` — compare the installed version to a specific older version. Useful for "what changed since 4.4.0?". Default: scan only the installed version (no comparison).

## Workflow

### Step 1: Locate the installed Zod surface

Find the `.d.ts` for the relevant Zod constructs in `node_modules/zod/`. The current layout (Zod v4) puts them under:

- `node_modules/zod/dist/types/v4/core/to-json-schema.d.ts` — the main `toJSONSchema` function + options type.
- `node_modules/zod/dist/types/v4/core/registries.d.ts` — `z.registry()` + global registry shape.
- `node_modules/zod/dist/types/v4/core/meta.d.ts` — `.meta()` semantics.
- `node_modules/zod/dist/types/v4/core/json-schema-processors.d.ts` — internal processors the override hook integrates with.

If the layout has changed (e.g. Zod restructured `dist/`), fall back to globbing for the symbol names: `grep -rln "function toJSONSchema" node_modules/zod/`.

### Step 2: Extract the option-bag shape

Read the `ToJSONSchemaOptions` type (or whatever Zod has renamed it to). Capture every key, its type, and any default values noted in JSDoc.

Watched keys (defined in [`references/zod-knowledge-map.md`](references/zod-knowledge-map.md)):

- `target` — `'draft-2020-12' | 'openapi-3.1'`. We use `'openapi-3.1'`.
- `metadata` — registry to read `.meta()` from.
- `unrepresentable` — `'throw' | 'any'`. We use `'throw'` in strict mode, `'any'` otherwise.
- `override` — callback. We pass our composition + primitive override chain.
- `uri` — callback shaping `$ref` paths. We use this in bulk mode for direct `#/components/schemas/<id>` emission.
- `cycles` — `'ref' | 'throw'`. We use `'ref'` for recursion support.
- `reused` — `'inline' | 'ref'`. We use `'inline'` to avoid the `__shared/$defs` table.
- `io` — `'input' | 'output'`. Drives the I/O suffix split.

### Step 3: Diff against our consumption

Read `src/schema/engine.ts` — specifically the `buildToJsonSchemaOptions` function and how it composes the option bag. For each watched key:

- **We pass it, Zod still accepts it** → ✅ Aligned.
- **Zod added a new key we don't pass** → 💡 Opportunity — could we use it?
- **Zod removed / renamed a key we pass** → 🚫 Blocked — bump will break.
- **Zod changed the type of a key we pass** (e.g. `override` callback signature) → ⚠️ Needs investigation.

### Step 4: Check the override hook signature

Our composition override (`src/schema/composition.ts:createCompositionOverride`) and primitive override (`src/schema/override.ts:primitiveOverride`) both implement the `Override` type from Zod. If Zod changed `OverrideContext` or the return type, our overrides would break.

Read the `Override` and `OverrideContext` (or current names) from `to-json-schema.d.ts`. Compare against our type imports in `src/schema/engine.ts` and `src/schema/composition.ts`.

### Step 5: Check `.meta()` and registry semantics

Read `meta.d.ts` and `registries.d.ts`. Watched shapes:

- `z.globalRegistry` — we read from this in `bulkEmit` via the `metadata` option.
- `.meta({ id, title, description, examples, deprecated, cycles, ... })` — `id` is load-bearing for our DTO mapping.
- `z.registry<T>()` factory — our `createRegistry()` wraps this.

Any rename, signature change, or behaviour shift in these is high-impact.

### Step 6: Report

Output findings in markdown, one section per category. Format consistent with `/check-upstream-updates`:

```markdown
## /scan-zod-features (zod 4.4.2 → 4.5.0)

✅ Aligned
- `target`, `metadata`, `override`, `uri`, `cycles`, `reused`, `io`, `unrepresentable` — all still accepted.

💡 Opportunities
- New option `target: 'openapi-3.2'` (Zod 4.5.0). Not relevant — we pin to 3.1.

⚠️ Needs investigation
- `OverrideContext` gained a new `path` field. Our overrides destructure as `{ zodSchema, jsonSchema }`; adding `path` is backwards-compatible at the type level but enables a feature (composition by path) we could exploit.

🚫 Blocked
(empty)
```

Hand off this report to the caller. If invoked by `/check-upstream-updates`, it'll be inlined into the larger report.

## Out of scope

- **Schema-level emission semantics.** That's the engine's job; if Zod changes how `z.string()` emits, that's a different concern. The scanner watches the *options* and *plug-points*, not every Zod construct.
- **Other Zod modules.** Validation behaviour (`safeParseAsync`, refinements) lives in Zod's parsing core, not the JSON-schema surface. Out of scope here.

## Notes

- The `.d.ts` paths shift across Zod versions. Update [`references/zod-knowledge-map.md`](references/zod-knowledge-map.md) when a layout change is detected.
- Zod's JSON Schema surface is the part most likely to evolve as JSON Schema drafts and OpenAPI versions advance — this scanner is the canary.
