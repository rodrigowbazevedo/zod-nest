# pitfalls

Known gotchas during a `nestjs-zod` → `zod-nest` migration. The skill surfaces
each at the relevant step and links the user to the canonical FAQ entry.

## Hybrid `class-validator` + `createZodDto` projects

Some projects mix `class-validator`-decorated DTOs (legacy) with
`createZodDto` (newer). `zod-nest` doesn't conflict — but it also doesn't
interoperate. Keep each DTO single-library; don't add `@IsString()` on a
`zod-nest` DTO and don't expect Zod refinements to run on a `class-validator`
DTO.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#faq--troubleshooting>
(see "Can I use class-validator decorators on a zod-nest DTO?").

## Deep `ZodSerializerDtoOptions` integrations

`nestjs-zod` accepted a magic-string option object on `@ZodSerializerDto`. In
`zod-nest`, the equivalent behaviour is expressed in the schema itself
(`z.pipe`, `z.transform`, `.default()`, etc.). Projects that built custom
output transformation on `ZodSerializerDtoOptions` need to move that logic
into the Zod schema. Surface at Step 5.

## 500-body shape change — opaque `ZodSerializationException`

The default response body of `ZodSerializationException` (HTTP 500) no longer
includes the `errors` field. Any test asserting on the response shape of a
500-class error will fail.

```diff
  {
    "statusCode": 500,
    "message": "Response validation failed"
-   "errors": { /* zod error tree — gone */ }
  }
```

The full zod error tree still goes through the validation log channel and
remains accessible on the exception instance (`err.zodError`) for custom
filters. Operators see it; clients don't.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#serialization-exception-body-changes>.
Surface at Step 5 (when handlers are rewritten) and again at Step 8 (when
tests run).

## `@HttpCode` is no longer applied by `@ZodResponse`

`nestjs-zod`'s `@ZodResponse({ status: X })` called `@HttpCode(X)` internally.
`zod-nest`'s does not. Handlers that relied on the implicit `@HttpCode`
return the method default (`201` for POST, `200` for everything else), and
the `@ZodResponse({ status: X })` variant never matches — response goes
unvalidated.

Rule of thumb: every `@ZodResponse({ status: X })` whose X ≠ method default
needs a matching `@HttpCode(X)` next to it. Exception-driven statuses
(`throw new NotFoundException()` → 404) don't need `@HttpCode` — Nest's
exception filter sets the response status itself.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-5--rewrite-response-handlers>.

## Discriminator change — `.isZodDto` → `isZodDto(Dto)`

Code that reflects on DTOs via `Dto.isZodDto === true` won't work. The new
discriminator is `Symbol.for('zod-nest.dto') in Dto`, or use the exported
`isZodDto(Dto)` predicate.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-7--fix-reflections--output-consumers>.

## `.Output` sibling — only when input/output diverge

The `MyDto.Output` sibling class always existed in `nestjs-zod`; in
`zod-nest` it only exists when the input and output JSON Schemas actually
differ (no `transform`, no `default`, no `pipe`). For non-divergent schemas,
`MyDto.Output === MyDto` in effect. For type-level work on a single schema,
prefer `z.output<typeof schema>` — it's stable regardless of suffix
behaviour.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-7--fix-reflections--output-consumers>.

## OpenAPI version pin — 3.1 only

`applyZodNest` always emits OpenAPI 3.1; there's no version flag. If the
consumer ecosystem (codegen, clients, SaaS validators) requires 3.0, run
`applyZodNest` first, then a standalone downgrade tool like
`openapi-down-convert` against the result.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#step-4--rewrite-swagger-setup>.

## Async refinements

The pipe uses `safeParseAsync`, so async refinements work without extra
wiring. If they don't fire post-migration, the issue is usually a missing
DTO wiring (`@Body() body: UserDto` where `UserDto` is a `createZodDto`
class), not the refinement itself.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#faq--troubleshooting>
(see "My async validation refinements don't fire.").

## Recursive schemas — cycles flag

If recursive schemas emit cycle errors, set `cycles: 'ref'` in `.meta(...)`
and give the schema an `id` (`.meta({ id: 'Comment', cycles: 'ref' })`).

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/recipes/recursive-schemas.md>.
