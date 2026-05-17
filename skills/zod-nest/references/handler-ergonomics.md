# handler-ergonomics

Diagnostic catalog for the **Handler ergonomics** section of the `zod-nest`
skill. Each rule is a thin trigger + canonical-doc URL.

## 1. Missing `@ZodResponse`

**Detection** — a controller method whose return type is a class extending
`createZodDto(...)`, **and** the method has no `@ZodResponse(...)` decorator
above it.

**Severity** — 🔴 (clear miss). Without `@ZodResponse`, the response is not
validated at runtime and the OpenAPI doc loses the zod-derived schema.

**Proposed edit** — add `@ZodResponse({ type: <Dto> })`:

```diff
  @Get(':id')
+ @ZodResponse({ type: UserDto })
  getUser(@Param('id') id: string): Promise<UserDto> {
    /* ... */
  }
```

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/responses.md>.

## 2. Multi-status candidate

**Detection** — a controller method has:

- One `@ZodResponse(...)` (success variant), **and**
- At least one `@ApiResponse(...)` / `@ApiOkResponse(...)` /
  `@ApiNotFoundResponse(...)` / `@ApiBadRequestResponse(...)` etc. for a
  *different* status.

**Severity** — 🟡 (likely improvement). The non-success variants are
doc-only — not validated. Stacking `@ZodResponse` per status gets runtime
validation on every documented response.

**Proposed edit** — convert the non-success `@Api*Response({ type })` calls
into stacked `@ZodResponse({ status, type })`:

```diff
  @Get(':id')
  @ZodResponse({ type: UserDto })
- @ApiNotFoundResponse({ type: ErrorDto })
+ @ZodResponse({ status: 404, type: ErrorDto })
  getUser(@Param('id') id: string): unknown { /* ... */ }
```

The success variant can omit `status` — the precedence chain
(`@HttpCode` → method default → `@ZodResponse({ status })` matching) handles
it. Set `status` explicitly only on off-happy-path variants.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/responses.md>.

## 3. Redundant `@ApiOkResponse({ type })`

**Detection** — `@ApiOkResponse({ type: Dto })` appears next to
`@ZodResponse({ type: Dto })` (same Dto) on the same handler.

**Severity** — 🟡. The `@ApiOkResponse` is dead weight — `@ZodResponse`
already declares the doc entry and validates.

**Proposed edit** — remove the `@ApiOkResponse`:

```diff
  @Get(':id')
- @ApiOkResponse({ type: UserDto })
  @ZodResponse({ type: UserDto })
  getUser(): Promise<UserDto> { /* ... */ }
```

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/responses.md>.

## Status resolution precedence — one bullet

When proposing multi-status patterns, agents should know the precedence chain
applied at request time:

- **`@HttpCode(X)` wins.** If the handler has `@HttpCode(X)`, the response
  status is `X` and `@ZodResponse({ status: X })` matches.
- **Otherwise, NestJS method default.** `POST` → 201, everything else → 200.
- **Thrown exceptions override.** `throw new NotFoundException()` → 404,
  regardless of `@HttpCode`. `@ZodResponse({ status: 404 })` then matches.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/responses.md>.

## Out of scope

- **`@HttpCode` ↔ `@ZodResponse` consistency checks** — the skill doesn't
  diagnose a missing `@HttpCode` next to `@ZodResponse({ status: X })`. That's
  a runtime-behaviour check; surface it during migration (the
  `zod-nest-migrate` skill carries this rule), not on routine edits.
- **Exception-filter configuration** — out of scope. `createValidationException`
  / `createSerializationException` are user-controlled knobs.
- **Auto-applying edits** — diagnostic only.
