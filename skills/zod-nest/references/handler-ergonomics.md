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
  _different_ status.

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

## 3. Redundant `@Api*Response({ type })` next to `@ZodResponse({ type })`

**Detection** — any of `@ApiResponse` / `@ApiOkResponse` / `@ApiCreatedResponse`
/ `@ApiNoContentResponse` / etc. appears next to a `@ZodResponse({ type: Dto })`
for the same DTO and (resolved) status on the same handler.

**Severity** — 🟡. Since `zod-nest@1.4.0`, `@ZodResponse` is a composite
decorator: it applies `@ApiResponse(...)` internally, so the doc entry is
already written. The manual `@Api*Response` is dead weight and risks drifting
out of sync with the validated DTO.

**Proposed edit** — remove the redundant `@Api*Response`:

```diff
  @Get(':id')
- @ApiOkResponse({ type: UserDto })
  @ZodResponse({ type: UserDto })
  getUser(): Promise<UserDto> { /* ... */ }
```

**Non-JSON content exception → Rule 4.** A manual `@Api*Response` carrying a
`content` map for a non-JSON media type (binary downloads, SSE, NDJSON) is no
longer something `@ZodResponse` "can't express" — it's a Rule 4 case. Don't
propose a plain deletion; route to Rule 4's `contentType` replacement below.

Canonical: <https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/responses.md>.

## 4. Hand-written stream / binary response (use `contentType` / `stream`)

**Detection** — a handler that either:

- declares a non-JSON response by hand —
  `@ApiOkResponse` / `@ApiResponse` / `@ApiCreatedResponse` with
  `content: { '<media type>': { schema } }` where the media type is a stream /
  binary one (`text/event-stream`, `application/x-ndjson`,
  `application/octet-stream`, `application/pdf`, `image/*`, `audio/*`,
  `video/*`), **or**
- is `@Sse(...)` / carries `@Header('Content-Type', '<stream type>')` and has
  **no** `@ZodResponse`.

**Severity** — 🟡 (likely improvement). Since the `contentType` + `stream`
options landed, `@ZodResponse` models these directly: the DTO documents one
event / line / blob, the OpenAPI card uses the right media-type key, and
validation is skipped (a streamed body has nothing to validate against).

**Proposed edit** — collapse to a single `@ZodResponse` with `contentType`
(the DTO describes one event/line):

```diff
  @Sse('events')
- @ApiOkResponse({ content: { 'text/event-stream': { schema: { $ref: '#/components/schemas/Event' } } } })
+ @ZodResponse({ type: EventDto, contentType: 'text/event-stream' })
  streamEvents(): Observable<MessageEvent> { /* ... */ }
```

For a stream-typed `@Header('Content-Type', …)` already present, `contentType`
is inferred — `@ZodResponse({ type: EventDto })` alone suffices. For binary
downloads, pair with `overrideJSONSchema(BlobSchema, { type: 'string', format: 'binary' })`
and `@ZodResponse({ type: BlobDto, contentType: 'application/octet-stream' })`.
For an off-list content type, surface `stream: true` (per-handler) or
`ZodNestModule.forRoot({ streamContentTypes: [...] })` (global).

Canonical:
<https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/responses.md#streaming-responses-contenttype--stream>,
<https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/recipes/streaming-responses.md>,
<https://github.com/rodrigowbazevedo/zod-nest/blob/main/docs/recipes/binary-downloads.md>.

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
