# Doc layout — `src/` area → companion doc mapping

Canonical mapping the `/sync-docs` skill uses to find which doc to inspect when a given `src/` area changes. Update when phases add or rename companion docs.

## Public-facing docs (top-level)

| File | What it covers |
|---|---|
| `README.md` | Features list, differences from `nestjs-zod`, non-goals, quickstart, core concepts, usage per feature (concise), module options table, logging summary, composition (experimental) callout, API reference (compact link-out), documentation index, migration TL;DR, contributing, license. |
| `MIGRATION.md` | Full nestjs-zod → zod-nest migration: TL;DR, prerequisites, install/uninstall, 22-row breaking-changes side-by-side table, 8 step-by-step migration steps with diffs, serialization-exception body-changes section, worked example, FAQ. |
| `CONTRIBUTING.md` | Local dev (Node, npm), useful scripts, test layout, commit-message convention tied to semantic-release, recipe-adding workflow, PR submission, reporting. |
| `CODE_OF_CONDUCT.md` | Adopts Contributor Covenant 2.1 by reference. |
| `NOTICE` | Attribution to `nestjs-zod` (MIT) for the names lifted. |

## Companion deep-dives (`docs/`)

Each is self-contained — a reader landing here from a README link doesn't need to bounce back.

| `src/` area | Companion doc | Covers |
|---|---|---|
| `src/dto/` | `docs/dto.md` | `createZodDto`, id resolution, `.Output` sibling, I/O suffix truth table, codec via Zod, custom registries, runtime guards. |
| `src/pipes/` | `docs/validation-pipe.md` | `ZodValidationPipe` constructor shapes, auto-detect, failure flow, exception factory precedence, async refinements, introspection surface. |
| `src/decorators/`, `src/interceptors/`, `src/response/` | `docs/responses.md` | `@ZodResponse` type shapes, multi-status stacking, status resolution precedence (no internal `@HttpCode`), `passthroughOnError`, single/array/tuple emission. |
| `src/document/` | `docs/swagger-integration.md` | `applyZodNest`, 6-pass pipeline, doc-build errors (`AMBIGUOUS_RENAME`, `DANGLING_REF`), `strict` mode, `Override` callback, custom registries, mutation contract. |
| `src/module/` | `docs/module-options.md` | Every `ZodNestModuleOptions` key, `ZOD_NEST_OPTIONS` token, `NormalizedZodNestOptions`, precedence summary, redaction semantics. |
| `src/logging/` | `docs/logging.md` | When logging fires, payload shape (input-only vs output-only fields), DTO labels, redaction (case-insensitive, deep, structural), `[CIRCULAR]` guard, truncation envelope, pino adapter example, performance notes. |
| `src/schema/composition.ts` | `docs/composition.md` | `extend` + `getLineage`, builder-only schema-change rule, `allOf` emission, anonymous-parent fallback, multi-level chains, current limitations, `@experimental` rationale. |
| `src/exceptions/` | `docs/exceptions.md` | Class hierarchy, response bodies, "why the 500 has no `errors` field" policy, custom filter patterns, factory inheritance recipe. |
| `src/schema/` (engine + registry + override) | *no dedicated companion* — the engine surface is documented through `docs/dto.md` (consumers) and `docs/swagger-integration.md` (override callback). |

## Recipes (`docs/recipes/`)

One recipe per concrete usage pattern. Cross-linked from the relevant companion doc.

| Recipe | Covers |
|---|---|
| `docs/recipes/custom-validation-exception.md` | Module-scope + per-pipe override, `argMetadata.type` branching, correlation-id pattern. |
| `docs/recipes/custom-serialization-exception.md` | Error-tracker forwarding, opaque-body substitution, when the factory doesn't run, validation vs serialization comparison table. |
| `docs/recipes/multi-status-responses.md` | Stacked decorators, status resolution at request time, validating thrown-exception bodies, mixing strict + soft. |
| `docs/recipes/shared-input-output-schema.md` | When schemas collapse vs split, forcing a collapse with `z.pipe`, forcing a split with two ids, `.Output` use cases. |
| `docs/recipes/recursive-schemas.md` | `z.lazy` + `.meta({ id })` pattern, mutually recursive schemas, tree-shaped generics, what doesn't work. |
| `docs/recipes/discriminated-unions.md` | `z.discriminatedUnion` → `oneOf` + `discriminator` mapping, three-branch job-state example, what doesn't work. |
| `docs/recipes/custom-openapi-overrides.md` | File uploads, opaque blobs, `z.date` → `format: date-time`, `z.bigint` → string with pattern, composing multiple overrides. |

## Cross-cutting docs

- `docs/why-this-exists.md` — origin story, what's intentionally dropped, what's kept simple, forward-compat via Zod's emitter, what's experimental.

## When to update this file

Whenever a phase adds a new `docs/*.md` or `docs/recipes/*.md` file, append the row here. Whenever a doc is renamed, retired, or split, update the corresponding cell. `/sync-docs` reads this file at runtime — the skill is only as accurate as the mapping.
