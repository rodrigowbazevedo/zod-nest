# NestJS knowledge map

Reference for `/scan-nest-features`. Lists every NestJS API zod-nest depends on, where it lives in the installed package, what we use it for, and where our consumer lives.

## `@nestjs/swagger`

| Watched symbol | Where in node_modules | What we use it for | Our consumer |
|---|---|---|---|
| `_OPENAPI_METADATA_FACTORY` (static method on DTO class) | `dist/plugin/...` (TS-plugin emit) + read by `SchemaObjectFactory` | The runtime hook that lets us inject Zod-derived schemas into the doc. Highest-impact watch. | `src/dto/create-zod-dto.ts:82-84` (emit), `src/dto/marker.ts` (payload) |
| `SchemaObjectFactory` | `dist/services/schema-object-factory.d.ts` | Reads `_OPENAPI_METADATA_FACTORY` and materializes `components.schemas[<DtoName>]`. We don't call this — we co-operate with it via the marker bridge. | `src/document/apply-zod-nest.ts` (consumer of resulting doc), `src/dto/marker.ts` |
| `SwaggerExplorer` | `dist/swagger-explorer.d.ts` | Walks the doc's `paths`. We follow its `$ref` output for input-side usage collection. | `src/document/collect-usage.ts` |
| `DocumentBuilder` | `dist/document-builder.d.ts` | Constructs the raw doc. Used in tests + docs examples. Stable. | `test/document/apply-zod-nest.spec.ts` (consumer pattern in tests) |
| Plugin shape (`model-class.visitor`) | `lib/plugin/visitors/model-class.visitor.d.ts` | The TS plugin emits `_OPENAPI_METADATA_FACTORY` at compile time for class DTOs. We emit at runtime, but if the plugin shape changes the reader contract, our emit breaks. | n/a (we don't consume the plugin directly) |

## `@nestjs/common`

| Watched symbol | Where in node_modules | What we use it for | Our consumer |
|---|---|---|---|
| `Reflector` | `dist/services/reflector.service.d.ts` | `getAllAndOverride`, `get` — read decorator metadata at request time. | `src/interceptors/serializer.interceptor.ts:39` (Reflector injection), all skills that consume `Reflector.get` |
| `PipeTransform` interface | `dist/pipes/pipe-transform.interface.d.ts` | Contract our `ZodValidationPipe` implements (`transform(value, metadata)`). | `src/pipes/validation.pipe.ts:34` |
| `NestInterceptor` interface | `dist/interceptors/nest-interceptor.interface.d.ts` | Contract our `ZodSerializerInterceptor` implements (`intercept(ctx, next)`). | `src/interceptors/serializer.interceptor.ts:34` |
| `@HttpCode` decorator | `dist/decorators/http/...` | We don't apply it; we **read** the metadata it sets. | `src/response/default-status.ts:22-25` |
| `METHOD_METADATA`, `HTTP_CODE_METADATA` constants | `dist/constants.d.ts` (or `.js`) | The reflect-metadata keys we read to compute default response status. | `src/response/default-status.ts:2` (import), `test/response/default-status.spec.ts` (pinned by assertion) |
| `ExecutionContext` | `dist/interfaces/features/execution-context.interface.d.ts` | Passed into the interceptor + `createSerializationException` factory. We walk it to get the request, handler, class. | `src/interceptors/serializer.interceptor.ts:30-31` (handler/class labels) |
| `ArgumentMetadata` | `dist/interfaces/features/pipe-transform.interface.d.ts` | Passed into the pipe + `createValidationException` factory. We read `type` (body/query/param/custom) and `metatype` (the DTO class). | `src/pipes/validation.pipe.ts:52`, `src/exceptions/validation.exception.ts` |
| `BadRequestException`, `InternalServerErrorException` | `dist/exceptions/*.d.ts` | Base classes for `ZodValidationException` and `ZodSerializationException`. | `src/exceptions/*.ts` |

## `@nestjs/core`

| Watched symbol | Where in node_modules | What we use it for | Our consumer |
|---|---|---|---|
| `DiscoveryService` | `dist/discovery/discovery-service.d.ts` | Walks controllers + their methods to pick up `@ZodResponse` output-side metadata that the raw OpenAPI doc doesn't surface. | `src/document/collect-usage.ts` (controller-graph walk in `collectOutputExposedIds`) |
| `MetadataScanner` | `dist/metadata-scanner.d.ts` | Helper for walking handler methods on a controller prototype. | `src/document/collect-usage.ts` |
| `APP_PIPE`, `APP_INTERCEPTOR` providers | `dist/constants.d.ts` | DI tokens for global pipe + interceptor registration in `ZodNestModule.forRoot()`. | `src/module/zod-nest.module.ts` |
| `MODULE_METADATA` constants | `dist/constants.d.ts` | Used implicitly by the module decorator; we don't read it directly. | n/a |

## Source repos for deeper reads

When the `.d.ts` isn't enough — e.g. to understand a behavioural change that doesn't show up in the type:

- [`nestjs/swagger`](https://github.com/nestjs/swagger) — paths under `lib/services/`, `lib/plugin/`, `lib/explorers/`.
- [`nestjs/nest`](https://github.com/nestjs/nest) — paths under `packages/common/`, `packages/core/`.

GitHub Releases for each are the highest-signal changelog source.

## Highest-impact watches (in priority order)

1. **`_OPENAPI_METADATA_FACTORY` shape** — release-blocker if it changes.
2. **`Reflector.get` / `getAllAndOverride` signature** — release-blocker if it changes.
3. **`PipeTransform.transform` + `NestInterceptor.intercept` signatures** — release-blocker if they change.
4. **`METHOD_METADATA`, `HTTP_CODE_METADATA` constant string values** — silent wrong-status if they change without test failure (we pin them in tests but the constant value is what `Reflect.getMetadata` reads).
5. **`DiscoveryService.getControllers()`** — silently empty output side if it changes.
6. **`SchemaObjectFactory` internals** — opportunity, not blocker (we co-operate with it via the marker bridge).
7. **`DocumentBuilder`** — stable. Update on bumps; rarely actionable.

## When to update this file

- Nest's package layout shifts — update the "Where in node_modules" column.
- We start consuming a new symbol from any of the three packages — add a row.
- We drop reliance on a watched API — remove its row (history lives in git).
- A new high-impact watch emerges — re-rank the priority list.
