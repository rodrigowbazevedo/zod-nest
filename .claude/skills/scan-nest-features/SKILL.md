---
name: scan-nest-features
description: >
  Surface scanner for the NestJS APIs that zod-nest consumes — `@nestjs/swagger` (`_OPENAPI_METADATA_FACTORY`, `SchemaObjectFactory`, `SwaggerExplorer`, `DocumentBuilder`, plugin shape), `@nestjs/common` (Reflector, pipe + interceptor contracts, `@HttpCode`, method metadata constants), `@nestjs/core` (DiscoveryService). Reads the installed `node_modules/@nestjs/*/dist/*.d.ts` and diffs shapes against what `src/document/`, `src/pipes/`, `src/interceptors/`, `src/decorators/` consume. Use whenever NestJS or `@nestjs/swagger` is bumped, when `/check-upstream-updates` invokes it as part of the `nest` target, or when debugging a NestJS-integration issue. Reports inline; the orchestrator weaves findings into the larger upstream report.
---

# scan-nest-features

Source-aware scanner for the NestJS surfaces zod-nest depends on. Three packages collapse into one scanner because they evolve together: `@nestjs/swagger` provides the OpenAPI bridge, `@nestjs/common` provides the runtime contracts (pipes, interceptors, decorators), and `@nestjs/core` provides the introspection tools (`DiscoveryService`, `Reflector`).

## When to invoke

- **As part of `/check-upstream-updates --target nest|all`.** The orchestrator hands off; this skill returns findings.
- **Standalone after a Nest major or minor bump.** The plugin emit and metadata-factory shape are the highest-risk areas — verify them.
- **When debugging a Nest-integration issue** — e.g. a controller's `@ZodResponse` doesn't show up in the doc. The scanner shows whether the explorer / discovery API still works the way we assume.

## Inputs

Optional:

- `--package swagger|common|core|all` — narrow the scan. Default `all`.

## Workflow

### Step 1: Locate the installed Nest surfaces

For each package in scope:

| Package           | Key `.d.ts` files                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/swagger` | `node_modules/@nestjs/swagger/dist/services/schema-object-factory.d.ts`, `swagger-explorer.d.ts`, `lib/plugin/visitors/model-class.visitor.d.ts`, `document-builder.d.ts`                                                                 |
| `@nestjs/common`  | `node_modules/@nestjs/common/dist/services/reflector.service.d.ts`, `pipes/pipe-transform.interface.d.ts`, `interceptors/nest-interceptor.interface.d.ts`, `decorators/http/route-params.decorator.d.ts`, `@nestjs/common/constants.d.ts` |
| `@nestjs/core`    | `node_modules/@nestjs/core/dist/discovery/discovery-service.d.ts`, `metadata-scanner.d.ts`                                                                                                                                                |

If a layout has shifted, fall back to globbing for the symbol: `grep -rln "<symbol>" node_modules/@nestjs/<pkg>/`.

### Step 2: Diff watched symbols vs our consumption

Read [`references/nest-knowledge-map.md`](references/nest-knowledge-map.md) for the full watch-list with file paths into our `src/`. For each watched symbol:

- Look up its current shape in the installed `.d.ts`.
- Locate our consumer in `src/` (the map names the exact file + function).
- Compare:
  - **Symbol unchanged** → ✅ Aligned.
  - **New non-breaking field / method on the symbol** → 💡 Opportunity.
  - **Symbol renamed or removed** → 🚫 Blocked.
  - **Symbol shape changed (signature, parameter type, return type)** → ⚠️ Needs investigation.

### Step 3: Specifically verify the metadata-factory contract

The DTO bridge relies on `_OPENAPI_METADATA_FACTORY` being a **static method** on the DTO class. If Nest's plugin emit changes this (e.g. to an instance method, async, or another shape), our `createZodDto` output stops being introspected by `SchemaObjectFactory`.

Steps:

1. Find `_OPENAPI_METADATA_FACTORY` references in `node_modules/@nestjs/swagger/dist/`.
2. Verify the signature is still: `() => Record<string, unknown>` (synchronous, no `this`).
3. Cross-reference our emit in `src/dto/create-zod-dto.ts:82-84` (the `static _OPENAPI_METADATA_FACTORY()` method on the DTO class).

A mismatch here is the highest-severity finding the scanner can produce.

### Step 4: Verify method-metadata constants

We rely on `METHOD_METADATA` and `HTTP_CODE_METADATA` from `@nestjs/common/constants` to compute the default response status. If these constants are renamed or moved, `defaultStatusFor` (`src/response/default-status.ts:21-31`) silently returns the wrong default for POST handlers without `@HttpCode`.

Steps:

1. Read `node_modules/@nestjs/common/dist/constants.d.ts` (or `.js`).
2. Confirm `METHOD_METADATA` and `HTTP_CODE_METADATA` exist with the same string values.
3. Cross-reference `src/response/default-status.ts:2`.

This is asserted by tests at boot time (see `test/response/default-status.spec.ts`) but the scanner catches drift at install time before tests run.

### Step 5: Verify the DiscoveryService API

`applyZodNest` uses `DiscoveryService` to walk controllers and pick up `@ZodResponse` metadata. If the methods we call (`getControllers`, `getProviders`, or the controller-walker patterns) change shape, our doc post-processing breaks silently — the doc still builds but response variants disappear.

Steps:

1. Read `node_modules/@nestjs/core/dist/discovery/discovery-service.d.ts`.
2. Confirm `getControllers()` still returns instance wrappers and the prototype-walking pattern still works.
3. Cross-reference `src/document/collect-usage.ts` (the consumer).

### Step 6: Report

Output findings in markdown, one section per category, mirroring `/scan-zod-features`:

```markdown
## /scan-nest-features (@nestjs/swagger 11.0.3 → 11.0.5, @nestjs/common 11.0.0 → 11.0.2, @nestjs/core 11.0.0 → 11.0.2)

✅ Aligned

- `_OPENAPI_METADATA_FACTORY` shape unchanged.
- `Reflector` API stable.
- `METHOD_METADATA`, `HTTP_CODE_METADATA` constants unchanged.
- `DiscoveryService.getControllers()` signature unchanged.

💡 Opportunities

- `@nestjs/swagger` 11.0.5 added a `readonly-mode` plugin option that could replace our marker bridge in a future major. Not actionable now.

⚠️ Needs investigation
(empty)

🚫 Blocked
(empty)
```

Hand off this report to the caller. If invoked by `/check-upstream-updates`, it's inlined into the larger upstream report.

## Out of scope

- **Runtime Nest behaviour.** This scanner reads `.d.ts` types. Runtime bugs (e.g. lifecycle ordering, DI resolution) need integration tests, not type scanning.
- **Other Nest packages** (`@nestjs/testing`, `@nestjs/platform-express`, etc.). We use them in tests but they're not part of the public-consumer integration. Skip.
- **Plugin compile-time emission.** The TS plugin emits `_OPENAPI_METADATA_FACTORY` at compile time; we emit at runtime. Their plugin's shape isn't directly relevant to us as long as the runtime reader (`SchemaObjectFactory`) still understands what we produce.

## Notes

- `@nestjs/swagger`'s internal layout has shifted historically — keep [`references/nest-knowledge-map.md`](references/nest-knowledge-map.md) updated.
- The metadata-factory contract (Step 3) is the single highest-impact watch. A break there is a release blocker.
- This scanner is **type-level**. Runtime behaviour changes that preserve the type are still possible and need integration tests to catch.
