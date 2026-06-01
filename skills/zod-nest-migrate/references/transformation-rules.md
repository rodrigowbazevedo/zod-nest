# transformation-rules

One row per breaking change between `nestjs-zod` and `zod-nest`, framed as a
codemod pattern. Use these when proposing per-file diffs in Steps 3, 4, and 5
of the migration. The full side-by-side breaking-changes table — with
behavioural rationale — lives in
[MIGRATION.md § Breaking changes](https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#breaking-changes-side-by-side).

## Mechanical swaps

| Find                                                                                                        | Replace with                                                               | Notes                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `from 'nestjs-zod'`                                                                                         | `from 'zod-nest'`                                                          | All imports. Step 3.                                                                                                                    |
| `cleanupOpenApiDoc(rawDoc, { version: '3.1' })`                                                             | `applyZodNest(rawDoc, { app })`                                            | Step 4. `{ app }` is required (used for `DiscoveryService` walk).                                                                       |
| `cleanupOpenApiDoc(rawDoc)`                                                                                 | `applyZodNest(rawDoc, { app })`                                            | Step 4. Same — `app` must be passed explicitly.                                                                                         |
| `@ZodSerializerDto(Dto)` + `@ApiOkResponse({ type: Dto })`                                                  | `@ZodResponse({ type: Dto })`                                              | Step 5. Collapse both decorators into one.                                                                                              |
| `@ApiNotFoundResponse({ type: ErrorDto })` (next to a `@ZodResponse`)                                       | `@ZodResponse({ status: 404, type: ErrorDto })`                            | Step 5. Use stacking for validated multi-status.                                                                                        |
| `@ApiOkResponse({ content: { 'text/event-stream' \| 'application/x-ndjson': { schema } } })` (SSE / NDJSON) | `@ZodResponse({ type: Dto, contentType: '<type>' })`                       | Step 5. DTO = one event/line; `stream` inferred true → not validated.                                                                   |
| `@ApiOkResponse({ content: { 'application/octet-stream': { schema: { format: 'binary' } } } })` (binary)    | `@ZodResponse({ type: BlobDto, contentType: 'application/octet-stream' })` | Step 5. Pair with `overrideJSONSchema(BlobSchema, { type: 'string', format: 'binary' })`. Supersedes the old JSON-labelled binary note. |
| `Dto.isZodDto`                                                                                              | `isZodDto(Dto)` (imported from `zod-nest`)                                 | Step 7. Or use `Symbol.for('zod-nest.dto') in Dto`.                                                                                     |
| `Dto.Output.schema`                                                                                         | `z.output<typeof schema>` (where `schema` is the zod input)                | Step 7. `.Output` only exists when input/output diverge.                                                                                |
| `createZodDto(s, { codec: true })`                                                                          | Express in schema with `z.pipe` / `z.transform`                            | No `codec` flag in v0.                                                                                                                  |

## Behavioural — surface but don't auto-patch

These show up at migration time but the right "fix" is project-specific. Surface
the change at the relevant step and let the user decide.

| Concern                                                 | Old (`nestjs-zod`)                      | New (`zod-nest`)                                                                                                                     | Surface at      |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `@ZodResponse` no longer applies `@HttpCode` internally | Setting `status: 202` auto-set HTTP 202 | Caller must add `@HttpCode(202)` alongside `@ZodResponse({ status: 202 })`                                                           | Step 5          |
| `ZodSerializationException` body                        | Included `errors: { /* zod tree */ }`   | Opaque (`{ statusCode, message }` only)                                                                                              | Step 5 + Step 8 |
| OpenAPI version                                         | 3.0 or 3.1 (configurable)               | 3.1 only                                                                                                                             | Step 4          |
| `_Output` suffix                                        | Always present                          | Only when input/output JSON Schemas diverge                                                                                          | Step 7          |
| Input validation logging                                | None                                    | Opt-in via `ZodNestModule.forRoot({ validationLogs: true })`                                                                         | Step 6          |
| Off-list stream content types                           | n/a (manual `@ApiResponse` content)     | `ZodNestModule.forRoot({ streamContentTypes: ['text/csv', …] })` extends the built-in stream set (SSE/NDJSON/octet-stream/pdf/media) | Step 6          |
| Doc-build errors                                        | Silent / dangling refs at runtime       | Throws `ZodNestDocumentError` (`AMBIGUOUS_RENAME` / `DANGLING_REF`)                                                                  | Step 8          |

For each row, the canonical explanation lives in MIGRATION.md — link the user
to the relevant section before they decide. The breaking-changes table is at
<https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md#breaking-changes-side-by-side>.

## Dropped exports

The following exports from `nestjs-zod` are not in `zod-nest`. Remove the
import and use the suggested replacement.

| Removed                                  | Replacement                                                     |
| ---------------------------------------- | --------------------------------------------------------------- |
| `createZodGuard`                         | Use `schema.parse(input)` / `schema.safeParse(input)` directly. |
| `validate()` helper                      | Use `schema.parse(input)` / `schema.safeParse(input)` directly. |
| `ZodSerializerDtoOptions` (magic string) | Express behaviour in the schema itself.                         |

Canonical document:
<https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md>
