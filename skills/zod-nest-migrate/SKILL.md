---
name: zod-nest-migrate
description: >
  Migrate a NestJS project from `nestjs-zod` to `zod-nest`. Use when the user says
  "migrate from nestjs-zod", "switch to zod-nest", "upgrade nestjs-zod",
  "port nestjs-zod to zod-nest", "drop class-validator from nestjs-zod project",
  "convert createZodDto to zod-nest", or "replace cleanupOpenApiDoc with applyZodNest".
  Plan-then-apply orchestrator: audits the codebase, presents the 8-step migration
  plan from `MIGRATION.md`, then walks step-by-step with explicit user confirmation
  at each step. Heavy operation — invoke explicitly only; do not auto-trigger on
  unrelated file edits.
---

# zod-nest-migrate

Drives the `nestjs-zod` → `zod-nest` migration through the 8 steps documented at
<https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md>. The skill
is intentionally thin: it audits the codebase, gates each step on user
confirmation, and fetches canonical step content from `MIGRATION.md` at runtime
rather than duplicating it here.

## When to invoke

- **Explicit only.** Slash `/zod-nest-migrate`, or when the user asks to migrate
  from `nestjs-zod` / replace `cleanupOpenApiDoc` / drop `class-validator`.
- **Do not auto-trigger** on `nestjs-zod` imports, `*.controller.ts` edits, or
  any other file pattern. Migration is a heavy, multi-file operation — wait for
  the user to ask.

## Output contract

This skill drives a multi-turn interaction. At each step it prints:

1. **What the audit found** (Step 0 only).
2. **The current step's title + the canonical `MIGRATION.md` URL anchor.**
3. **A proposed per-file diff** for the user's codebase (after reading the
   canonical step content).
4. **A confirmation gate** — wait for explicit user yes before applying.

Never auto-apply. Never batch multiple steps without confirmation.

## Workflow

### Step 0 — audit

Before proposing any changes, gather the facts. Run these in parallel and report
findings in a short table:

- `package.json` — version of `nestjs-zod` (if present), `zod`, `class-validator`,
  `class-transformer`, `@nestjs/swagger`.
- `grep -rn "from 'nestjs-zod'" --include='*.ts' .` — count of import sites.
- `grep -rn "cleanupOpenApiDoc" --include='*.ts' .` — Swagger setup callsites.
- `grep -rn "@ZodSerializerDto\|createZodDto\|@ZodResponse\|ZodValidationPipe\|isZodDto\|\.Output" --include='*.ts' .` — decorator + DTO usage counts.
- `grep -rln "@nestjs/common\|@nestjs/swagger" --include='*.module.ts' --include='main.ts'` — module + bootstrap files.

Report each as a bullet under **Audit**. Do **not** propose changes yet.

If `nestjs-zod` is not installed, say so and stop — there's nothing to migrate.

### Step 1 — present the 8-step plan

Read [`references/migration-steps.md`](references/migration-steps.md) — it has
the 8 step titles and the canonical URL for each. Render them as a numbered list
with applicability markers based on the audit. Example:

```
Migration plan (8 steps):
  1. ✅ Bump Zod to v4              — audit shows zod ^3.x, action needed
  2. ✅ Swap nestjs-zod → zod-nest  — audit shows nestjs-zod installed
  3. ✅ Swap imports                — 14 files import from 'nestjs-zod'
  4. ✅ Rewrite Swagger setup       — 1 cleanupOpenApiDoc callsite
  5. ✅ Rewrite response handlers   — 23 @ZodSerializerDto + 5 @ApiOkResponse callsites
  6. ⚪ Register ZodNestModule.forRoot (optional)
  7. ⚠️ Fix reflections / .Output  — 2 .isZodDto reads + 1 .Output reference
  8. ✅ Verify the migration
```

Then: **"Confirm to proceed with Step 1?"** — wait for user.

### Steps 2–9 — execute one step at a time

For each step the user confirms, the orchestration is identical:

1. **Print the canonical URL** for the step (from `references/migration-steps.md`).
2. **Fetch the section content** (WebFetch the URL, or the agent's equivalent).
   The MIGRATION.md section contains commands, code diffs, and behavioural
   notes — apply them to the user's codebase.
3. **Cross-cutting reminders** (consult [`references/pitfalls.md`](references/pitfalls.md)):
   - Step 5 — call out the [`@HttpCode` rule](https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-5--rewrite-response-handlers):
     every `@ZodResponse({ status: X })` where X ≠ method default needs a
     matching `@HttpCode(X)`.
   - Step 7 — call out the discriminator change (`.isZodDto` → `isZodDto(Dto)`)
     and `.Output` shape change.
   - Step 8 — call out the [500-body opacity change](https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#serialization-exception-body-changes):
     tests asserting on the `errors` field of a `ZodSerializationException`
     response will fail.
4. **Propose per-file diffs** for the user's codebase. Show the diffs; **do not
   apply** until the user confirms.
5. **Apply, then recap.** Once confirmed and applied, briefly summarize what
   changed before asking permission to advance to the next step.

For mechanical bulk operations (Step 3: import swaps, Step 5: handler rewrites),
consider grouping by file: show a per-file diff list, confirm once, apply all.

### Pitfalls reference

Whenever a step surfaces a non-trivial gotcha — hybrid `class-validator` +
`createZodDto` projects, deep `ZodSerializerDtoOptions` usage, 500-body shape
change — pull the one-liner from [`references/pitfalls.md`](references/pitfalls.md)
and link the user to the canonical FAQ entry. Don't duplicate the explanation
inline.

### Transformation rules reference

For the per-call codemod patterns (`cleanupOpenApiDoc(...)` →
`applyZodNest(...)`, `@ZodSerializerDto + @ApiOkResponse` → `@ZodResponse`,
etc.), [`references/transformation-rules.md`](references/transformation-rules.md)
lists every breaking-changes-table row with its before/after shape. Use this
when proposing the per-file diff for Steps 3, 4, and 5.

## Notes

- `MIGRATION.md` is the single source of truth. This skill orchestrates; it
  does not replicate.
- Each step's canonical URL is in `references/migration-steps.md`. If
  GitHub renames a heading (and an anchor 404s), the agent should fall back to
  the document top and find the section by title.
- Out of scope: the auto-apply mode. Per-step confirmation is the only mode.
