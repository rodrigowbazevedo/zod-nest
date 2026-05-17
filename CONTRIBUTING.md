# Contributing to `zod-nest`

Thanks for your interest. `zod-nest` is a small, single-maintainer OSS project — issues, discussions, and PRs are all welcome. This doc covers what you need to know to get a local environment running and ship a contribution.

## Ground rules

- **Scope.** `zod-nest` covers Zod v4 → NestJS → OpenAPI 3.1. We don't take patches that re-introduce Zod v3 support, class-validator coexistence, OpenAPI 3.0 emission, or non-HTTP transports. See [`docs/why-this-exists.md`](docs/why-this-exists.md) for the rationale.
- **Be kind.** [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) applies to issues, PRs, and discussions.
- **Small PRs.** One concern per PR. A 50-line PR with one focused change is much easier to review than a 500-line PR touching five things.

## Local setup

You'll need:

- **Node ≥ 22** (the engines field is enforced).
- **npm** — the lockfile is npm's. If you prefer pnpm / yarn locally, that's fine, but please don't commit a switched lockfile.

```bash
git clone https://github.com/rodrigowbazevedo/zod-nest.git
cd zod-nest
npm install
```

That sets up the `husky` git hooks too. The pre-commit hook runs `prettier --write` and `eslint --cache --fix` on staged `*.ts` files only — it doesn't run tests.

## Useful scripts

| Script | What it does |
|---|---|
| `npm test` | Jest, full suite. |
| `npm run test:cov` | Jest with coverage report. |
| `npm run typecheck` | `tsc --noEmit` against `tsconfig.json`. |
| `npm run lint` | ESLint on the whole tree. |
| `npm run lint:fix` | ESLint with `--fix`. |
| `npm run format` | Prettier write over the whole tree. |
| `npm run build` | tsup build to `dist/` (CJS + ESM + .d.ts). |

`npm run prepublishOnly` chains lint + typecheck + test + build — that's the gate semantic-release uses, so running it locally is a good last check before pushing.

## Working with Claude Code (optional)

If you happen to use [Claude Code](https://claude.com/claude-code), the repo ships a `.claude/` config that wires up a few conveniences. **None of this is required to contribute** — every step in this guide works without it.

- **PostToolUse chain** runs `tsc --noEmit` + `eslint --fix --cache` + `prettier --write` automatically after Claude edits a TypeScript file. Purely a speed-up; the same checks run in CI either way.
- **PreToolUse pre-PR checks** fire before `gh pr create` and ask you to run a skill first when:
  - `src/` has changed without a matching update under `README.md` / `docs/` / `MIGRATION.md` → run `/sync-docs`.
  - `src/index.ts` or any `src/*/index.ts` has changed → run `/api-surface-audit`.

  Skip with `ZOD_NEST_SKIP_PRE_PR_CHECKS=1` for refactors that genuinely don't need either. Only fires inside Claude Code sessions.
- **Skills** under `.claude/skills/`:
  - `/sync-docs` — surface docs that need updating against the branch's `src/` diff.
  - `/api-surface-audit` — verify every public export has a test + follows naming conventions. Use before cutting a release.
  - `/schema-fixture` — add a parameterized Zod → OpenAPI test case to the engine spec suite.
  - `/check-upstream-updates` — audit `zod`, `@nestjs/swagger`, `@nestjs/common`/`core`, `rxjs` and file GitHub issues on actionable findings.
  - `/scan-zod-features`, `/scan-nest-features` — source-aware scanners that the upstream-updates orchestrator delegates to.

## Test layout

Tests live under `test/<area>/`, mirroring the `src/<area>/` structure:

```
test/
├── decorators/   → @ZodResponse, stacking, default-status
├── document/     → applyZodNest passes (collect-usage, merge, rewrite-refs, strip-markers, …)
├── dto/          → createZodDto behaviour, output sibling, types
├── exceptions/   → exception class shapes
├── interceptors/ → ZodSerializerInterceptor (smoke, failures, logging, passthrough)
├── logging/      → redaction, truncation, payload shape
├── module/       → ZodNestModule.forRoot, options normalization
├── pipes/        → ZodValidationPipe
├── response/     → variant metadata, status resolution
└── schema/       → engine, registry, composition, override, post-process
```

Smoke specs (`*.smoke.spec.ts`) bootstrap a real `NestFactory.create` app for end-to-end coverage. Unit specs are pure imports without a Nest app.

A few conventions worth following when adding tests:

- **Real bootstrap > mocks** for anything that touches NestJS' lifecycle. The smoke specs serve as templates.
- **Stable schema ids** in fixtures. Prefix fixtures by area (`Smoke_`, `Comp_`, `Output_`) to keep the test-time registry traceable when something cross-pollutes.
- **No `expect(true).toBe(true)`** unless the file is documented as compile-only (see `test/dto/create-zod-dto.types.spec.ts` for the pattern).
- **Cover the WHY**, not the WHAT. `it()` titles should encode the invariant, not the procedure.

## Commit messages

`zod-nest` uses [conventional commits](https://www.conventionalcommits.org/) — semantic-release reads them to decide whether the next release is major / minor / patch. The relevant prefixes:

- `feat:` → minor bump.
- `fix:` → patch bump.
- `feat!:` or `fix!:` (or any commit with a `BREAKING CHANGE:` footer) → major bump.
- `docs:`, `refactor:`, `test:`, `chore:` → no version bump.

Scoping (`feat(schema): ...`) is encouraged when the change is bounded to one area. The `(schema)` / `(document)` / `(dto)` / `(module)` etc. scopes track the `src/<area>/` layout.

Examples worth modelling on:

```
feat(decorators): support multi-status @ZodResponse stacking
fix(document): rewrite output-side refs when input/output schemas diverge
docs: clarify the no-internal-@HttpCode behaviour in responses.md
refactor(comments): strip Phase N internal labels from src + test
chore(release): 0.8.0 [skip ci]
```

## Adding a recipe

Recipes live under [`docs/recipes/`](docs/recipes/) and follow a consistent shape: one user-facing problem, one code example (preferably lifted from real tests), one short explanation. Keep them under ~150 lines.

To add one:

1. Create `docs/recipes/<your-recipe>.md`.
2. Cross-link from [`README.md`](README.md#documentation) (the Documentation table) and any related companion doc (e.g. a `docs/responses.md` recipe should be linkable from the Responses section).
3. If the recipe demonstrates a feature with a test, reference the test path in your PR description so reviewers can trace the example back to a passing snippet.

If you're not sure whether a topic warrants a recipe or belongs as inline content in a companion doc, open an issue and we'll figure it out together.

## Submitting a PR

1. Fork the repo, branch from `main`. Name the branch after the change (`fix/dangling-refs-hint`, `feat/composition-pick`).
2. Make the change. Add or update tests.
3. Run `npm run prepublishOnly` locally — that's the same gate CI runs.
4. Open the PR against `main`. Reference any related issues with `Closes #N` in the body.
5. CI runs Node 22 + Node 24 + coverage. All three must be green before merge.

If something on CI is failing for reasons that aren't obvious from the diff (flaky test, infra change), drop a note in the PR — happy to look into it together.

## Reporting issues

Use the [issue tracker](https://github.com/rodrigowbazevedo/zod-nest/issues). The templates cover bugs, features, and questions.

For bugs, the most useful reports include:

- A minimal reproduction — the smallest `nest new`-ish app or snippet that demonstrates the problem.
- The actual vs expected behaviour.
- `zod`, `zod-nest`, `@nestjs/swagger`, and Node versions.

For features, include the problem first, then the proposed solution. "I'd like to do X but the library makes it awkward because Y" is much easier to react to than "please add Z".

## License

By contributing, you agree that your contributions are licensed under the project's [MIT license](LICENSE).
