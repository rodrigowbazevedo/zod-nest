# AI tooling — `npx skills`

`zod-nest` ships two **AI-agent skills** that you can install into your own project to drive common `zod-nest` workflows from a coding agent (Claude Code, Cursor, Continue, …). Skills are distributed via the [`skills` CLI](https://github.com/vercel-labs/skills) directly from this repo — no separate package.

## What's shipped

| Skill                                   | Use it when…                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`zod-nest-migrate`](#zod-nest-migrate) | You have a project on [`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) and want an agent to walk you through the migration to `zod-nest`. |
| [`zod-nest`](#zod-nest)                 | You already use `zod-nest` and want an agent to surface schema-naming and `@ZodResponse` improvements as you edit controllers and DTOs.            |

## Install

All commands use [`npx skills`](https://github.com/vercel-labs/skills) — no global install needed.

```bash
# Both skills, into the current project's .claude/skills/
npx skills add rodrigowbazevedo/zod-nest

# Just one
npx skills add rodrigowbazevedo/zod-nest --skill zod-nest-migrate
npx skills add rodrigowbazevedo/zod-nest --skill zod-nest

# Global (across all projects)
npx skills add rodrigowbazevedo/zod-nest -g

# Inspect what's available
npx skills add rodrigowbazevedo/zod-nest -l
```

The CLI clones the relevant `skills/<name>/` folder into your project's `.claude/skills/<name>/` (or your user-level skills dir for `-g`). After installation the agent picks it up automatically — invoke with `/zod-nest-migrate` or `/zod-nest` in Claude Code (other agents follow their own conventions).

## `zod-nest-migrate`

**Mode:** explicit invocation (slash `/zod-nest-migrate` or "migrate from nestjs-zod"). Plan-then-apply per step — the skill orchestrates the agent through the 8-step migration documented in [`MIGRATION.md`](../MIGRATION.md), pausing for your confirmation at each step.

What it actually does:

1. Audits your project (`nestjs-zod` install, zod version, `class-validator`, `cleanupOpenApiDoc` callsites, decorator counts).
2. Renders the 8-step plan with applicability markers from the audit.
3. Walks the agent through each step — bump Zod → swap package → swap imports → rewrite Swagger setup → rewrite response handlers → register `ZodNestModule.forRoot` → fix reflections / `.Output` → verify.
4. At each step, the agent reads the canonical section of `MIGRATION.md` directly from this repo and proposes the per-file diffs for your codebase.
5. Surfaces cross-cutting reminders at the right step (`@HttpCode` rule, DTO discriminator change, 500-body opacity).

The skill is intentionally thin — `MIGRATION.md` is the source of truth, and the agent fetches it at runtime. That keeps the skill drift-free as `MIGRATION.md` evolves.

## `zod-nest`

**Mode:** diagnostic. Surfaces a checklist of proposed edits; never auto-applies.

**Auto-trigger:** when editing `*.controller.ts` or `*.dto.ts` files that import from `zod-nest`. Also slash-invokable as `/zod-nest`.

What it diagnoses:

- **Schema ergonomics** — missing `.meta({ id })` on reused schemas, inline `z.object(...)` inside `createZodDto` that should be hoisted, anonymous shared shapes, `extend()` composition opportunities (with the [`@experimental`](composition.md) caveat carried verbatim).
- **Handler ergonomics** — missing `@ZodResponse` on handlers returning `createZodDto` classes, single `@ZodResponse` where the multi-status intent suggests stacking, redundant `@ApiOkResponse({ type })` next to a `@ZodResponse` referencing the same DTO.

**Out of scope by design** — `passthroughOnError`, custom exception factories, `validationLogs`/`redactKeys`/logger configuration, `Override` callbacks. The skill avoids opinions on those knobs.

## Agent compatibility

- **[Claude Code](https://claude.com/claude-code)** — primary target. Auto-trigger via skill description; slash invocation.
- **[Cursor](https://cursor.com), [Continue](https://continue.dev), other [`skills`-compatible agents](https://github.com/vercel-labs/skills)** — supported on a best-effort basis. The skill bodies follow the agent-agnostic conventions of the `skills` CLI; specific invocation patterns vary per agent.

## Skill source

The skills live in this repo at [`skills/zod-nest-migrate/`](../skills/zod-nest-migrate/) and [`skills/zod-nest/`](../skills/zod-nest/). Open them to see exactly what gets installed.
