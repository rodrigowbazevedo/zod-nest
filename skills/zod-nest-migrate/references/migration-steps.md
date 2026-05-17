# migration-steps

Loop driver for the `zod-nest-migrate` skill. Each entry below is one step in
the 8-step migration documented at
<https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md>. The
skill walks the steps in order, fetching the canonical section content at the
URL when it's time to propose the diff.

| # | Title | Canonical URL |
|---|---|---|
| 1 | Bump Zod to v4 | <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-1--bump-zod> |
| 2 | Swap the package (`nestjs-zod` → `zod-nest`) | <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-2--swap-the-package> |
| 3 | Swap imports | <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-3--swap-imports> |
| 4 | Rewrite Swagger setup (`cleanupOpenApiDoc` → `applyZodNest`) | <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-4--rewrite-swagger-setup> |
| 5 | Rewrite response handlers (`@ZodResponse`, multi-status stacking) | <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-5--rewrite-response-handlers> |
| 6 | Register `ZodNestModule.forRoot()` (optional) | <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-6--register-zodnestmoduleforroot-recommended> |
| 7 | Fix reflections + `.Output` consumers | <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-7--fix-reflections--output-consumers> |
| 8 | Verify the migration | <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-8--verify-the-migration> |

## Applicability hints

Use the audit output (Step 0 of the orchestrator) to mark each step's
applicability before presenting the plan:

- **Step 1** — applies whenever `zod` is on a `^3.x` line.
- **Step 2** — applies whenever `nestjs-zod` appears in `package.json`.
- **Step 3** — applies whenever `from 'nestjs-zod'` appears in any `.ts` file.
- **Step 4** — applies whenever `cleanupOpenApiDoc` is called.
- **Step 5** — applies whenever `@ZodSerializerDto`, `@ApiOkResponse({ type: Dto })`
  (where `Dto` extends `createZodDto`), or `@ZodResponse` (old shape) appears.
- **Step 6** — optional. Recommend if `APP_PIPE` / `APP_INTERCEPTOR` are wired
  manually; otherwise present as a quality-of-life suggestion.
- **Step 7** — applies whenever `.isZodDto` is read on a DTO class or `.Output`
  is accessed on a `createZodDto`-extended class.
- **Step 8** — always applies. Final gate.

Canonical document:
<https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md>
