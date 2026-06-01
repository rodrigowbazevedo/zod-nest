# zod-nest — contributor workflow

Modern **Zod v4** ↔ **NestJS** ↔ **OpenAPI 3.1** integration. Successor to `nestjs-zod`. This file is the contributor-facing orientation; the user-facing surface is in [`README.md`](README.md).

If you're here to _use_ `zod-nest` in your own NestJS app, the README is what you want. Stay here for working on the library itself.

## Directory map

```
src/                          # public + internal source
├── decorators/               # @ZodResponse
├── document/                 # applyZodNest + post-processing pipeline
├── dto/                      # createZodDto, marker, output sibling
├── exceptions/               # ZodValidationException, ZodSerializationException, …
├── interceptors/             # ZodSerializerInterceptor
├── logging/                  # validation logger (redaction, truncation)
├── module/                   # ZodNestModule + options
├── pipes/                    # ZodValidationPipe
├── response/                 # @ZodResponse metadata + status resolution
├── schema/                   # engine, registry, composition, override
└── index.ts                  # the public API surface

test/                         # mirrors src/ layout; one *.spec.ts per area
docs/                         # public companion docs (one per area + recipes/)
├── dto.md / validation-pipe.md / responses.md / swagger-integration.md
├── module-options.md / logging.md / exceptions.md
├── composition.md / why-this-exists.md
└── recipes/                  # concrete usage patterns

MIGRATION.md                  # nestjs-zod → zod-nest migration guide
CONTRIBUTING.md               # public contributor entry point
CODE_OF_CONDUCT.md            # Contributor Covenant 2.1 by reference
NOTICE                        # attribution to nestjs-zod for lifted names
.github/                      # CI workflows + issue/PR templates
.claude/                      # optional Claude Code tooling (hooks + skills)
```

`.discovery/` and `.plan/` exist locally but are gitignored — research notes and phase plans that don't ship.

## Commands

Every command runs from the repo root with `npm`. The package manager is npm; please don't commit a different lockfile.

| Command                  | What it does                                                      |
| ------------------------ | ----------------------------------------------------------------- |
| `npm install`            | Installs deps + sets up the husky pre-commit hook.                |
| `npm run build`          | tsup build → `dist/` (CJS + ESM + `.d.ts`).                       |
| `npm run build:watch`    | tsup in watch mode.                                               |
| `npm test`               | Jest, full suite.                                                 |
| `npm run test:cov`       | Jest with coverage report.                                        |
| `npm run lint`           | ESLint over the tree.                                             |
| `npm run lint:fix`       | ESLint with `--fix`.                                              |
| `npm run format`         | Prettier write over the tree.                                     |
| `npm run typecheck`      | `tsc --noEmit` against `tsconfig.json`.                           |
| `npm run prepublishOnly` | Chains lint + typecheck + test + build. Runs as the release gate. |

`npm run release` (semantic-release) is **CI-only** — never run locally. The release path is push-to-`main` → semantic-release reads conventional commits → CI publishes to npm. Running it locally would attempt to publish from your machine.

## Workflow rules

- **No `any`.** ESLint config blocks it. Use `unknown` and narrow.
- **Every public export from `src/index.ts` has a matching `test/<area>/*.spec.ts`.** The `/api-surface-audit` skill enforces this.
- **PostToolUse chain runs on TS edits.** `.claude/settings.json` wires `tsc --noEmit` → `eslint --fix --cache` → `prettier --write` after every `Edit`/`Write`/`MultiEdit`. This is a speed-up for Claude Code sessions; the same checks run in CI either way.
- **Don't commit without being asked.** Stage + show the diff, wait for explicit "commit". Same applies to pushing and PR-opening.
- **Don't `npm publish` ever.** CI is the only publish path; running it locally bypasses semantic-release versioning.
- **Run lint + typecheck + test + build before presenting changes.** `npm run prepublishOnly` is the convenience chain.
- **Before `gh pr create`**: the `.claude/` PreToolUse hook runs two checks and blocks the PR if either fires. Run the relevant skill first to clear them:
  - If `src/` changed without README / docs / MIGRATION updates → run `/sync-docs`.
  - If `src/index.ts` or any `src/*/index.ts` changed → run `/api-surface-audit`.
  - Bypass both with `ZOD_NEST_SKIP_PRE_PR_CHECKS=1` for refactor-only PRs that genuinely don't need either.

## Conventions

- **Test mirror.** `test/<area>/<name>.spec.ts` corresponds to `src/<area>/<name>.ts`. Fixtures live next to the spec that consumes them.
- **Exception class names.** `<Name>Exception` for everything thrown over HTTP (`ZodValidationException`, `ZodSerializationException`). `<Name>Error` for non-HTTP errors (`ZodNestError`, `ZodNestUnrepresentableError`, `ZodNestDocumentError`).
- **OpenAPI extension keys.** Prefix `x-zod-nest-*` (e.g. `x-zod-nest-dto`, `x-zod-nest-error`). Always stripped from the final document for public-facing keys; only `x-zod-nest-error` is preserved (engine collision marker).
- **Metadata symbols.** `Symbol.for('zod-nest.<concept>')` so consumers in other realms (worker threads, vm) read the same registry.
- **Early-return / guard clauses.** Fail fast at the top of a function; keep the happy path at the lowest indent level. The codebase prefers this style; ESLint enforces `curly: all` so even single-line guards keep braces.
- **Schema-keyed metadata.**
  - **Stable, id-keyed** → `z.registry<T>()`. Used by `defaultRegistry` / `createRegistry`.
  - **Transient, per-instance** → `WeakMap<z.ZodType, T>`. Used by composition `lineageMap` and `propsMap`, by the I/O sibling cache in `output-dto.ts`.
- **Avoid TS `as` casts.** Type things properly first. Cast only when the type system genuinely can't follow — and document why with a comment.

## Public API surface

`src/index.ts` is the source of truth. The `/api-surface-audit` skill walks it and verifies every export has a matching file + test + naming-convention adherence. To see the current surface, read `src/index.ts` directly — listing it here would rot.

Areas → entry files for navigation:

| Area          | Entry                                                                                                         | Public surface                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema engine | `src/schema/index.ts`                                                                                         | `toOpenApi`, `createRegistry`, `defaultRegistry`, `Override`, `ZodNestError`, `ZodNestUnrepresentableError`, `extend`, `getLineage`, `LineageEntry`                    |
| DTO           | `src/dto/index.ts`                                                                                            | `createZodDto`, `isZodDto`, `ZodDto`, `Io`                                                                                                                             |
| Validation    | `src/pipes/index.ts` + `src/exceptions/index.ts`                                                              | `ZodValidationPipe`, `ZodValidationException`, `CreateValidationException`                                                                                             |
| Response      | `src/decorators/index.ts` + `src/interceptors/index.ts` + `src/response/index.ts` + `src/exceptions/index.ts` | `@ZodResponse`, `ZodSerializerInterceptor`, `ZodSerializationException`, `defaultStatusFor`, `resolveEffectiveStatus`, `ResponseVariant`, `ZOD_RESPONSES_METADATA_KEY` |
| Document      | `src/document/index.ts`                                                                                       | `applyZodNest`, `ApplyZodNestOptions`, `ZodNestDocumentError`                                                                                                          |
| Module        | `src/module/index.ts`                                                                                         | `ZodNestModule`, `ZodNestModuleOptions`, `NormalizedZodNestOptions`, `DEFAULT_REDACT_KEYS`, `DEFAULT_MAX_LOGGED_VALUE_BYTES`, `ZOD_NEST_OPTIONS`                       |

## Skills (`.claude/skills/`)

Optional convenience for contributors using Claude Code. None are required — every workflow step works without them.

| Skill                     | Purpose                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sync-docs`              | Diagnose drift between `src/` changes and user-facing docs on a branch. Surfaces a checklist; never auto-writes. Run before `gh pr create`.    |
| `/api-surface-audit`      | Verify every export in `src/index.ts` resolves to a file, has a matching test, and follows naming conventions. Use before cutting a release.   |
| `/schema-fixture`         | Add a Zod → OpenAPI fixture to the engine spec suite (`test/schema/engine.*.spec.ts`).                                                         |
| `/check-upstream-updates` | Audit upstream dependencies (`zod`, `@nestjs/swagger`, `@nestjs/common`+`@nestjs/core`, `rxjs`); file one GitHub issue per actionable finding. |
| `/scan-zod-features`      | Surface scanner for Zod's `toJSONSchema` options; usually invoked via `/check-upstream-updates`.                                               |
| `/scan-nest-features`     | Surface scanner for `@nestjs/swagger` + `@nestjs/common` + `@nestjs/core`; usually invoked via `/check-upstream-updates`.                      |

## Phase branching & PR workflow

Each phase ships as its own branch + PR targeting `main` (no direct commits to `main`):

- Cut the phase branch off fresh `main`: `git checkout main && git pull --ff-only`, then `git checkout -b phase-<id>-<slug>`.
- Match the branch name to the `.plan/` filename's phase id where one exists.
- One PR per phase by default. Splitting is fine for large phases — keep sub-PRs sequenced against `main` and reference the phase id in each title.
- Use conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`) — semantic-release reads them on squash-merge to compute the next version bump. Pre-1.0, minor bumps can be breaking; document them in the body with a `BREAKING CHANGE:` footer only if a true major is intended.
- See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the public contributor-facing workflow, the `.github/PULL_REQUEST_TEMPLATE.md` checklist, and reporting/issue guidance.

## Risk register

Top failure modes and how we mitigate them:

| Risk                                                                                                  | Mitigation                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zod v4 API churn** — `toJSONSchema` options, `.meta()` registry semantics, override hook shape      | `/check-upstream-updates --target zod` invokes `/scan-zod-features`; type-level tests catch shape changes at install time; pinned floor in `peerDependencies`.                                                    |
| **`@nestjs/swagger` internal refactor** — `SchemaObjectFactory`, `SwaggerExplorer`, plugin emit shape | `/scan-nest-features` flags shape divergence; integration tests assert the marker-placeholder contract end-to-end.                                                                                                |
| **`_OPENAPI_METADATA_FACTORY` shape change** — specifically, if it becomes non-static or async        | The DTO marker bridge in `src/dto/` breaks; mitigation = explicit assertion test (`test/dto/create-zod-dto.swagger-smoke.spec.ts`) + version-pinned compat-matrix cell.                                           |
| **Maintainer bandwidth**                                                                              | `/check-upstream-updates` cadence is manual-only (no scheduled automation). Skill set scoped to library maintenance, not consumer scaffolding — keeps `.claude/skills/` small enough that one person can hold it. |

Findings from `/check-upstream-updates` become GitHub issues labelled `upstream-update` — the issue tracker is the audit trail.
