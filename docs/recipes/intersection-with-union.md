# Recipe: Schemas that don't fit a class (intersections, unions, discriminated unions)

`createZodDto(schema)` returns a class. TypeScript only allows **object types** (or intersections of object types) as class bases — so any schema whose `z.infer<>` resolves to a TS union breaks at the class declaration with TS2509:

> Base constructor return type `…` is not an object type or intersection of object types with statically known members.

Shapes that trigger this:

- `z.intersection(SomeObject, z.union([A, B]))` — TS distributes `Obj & (A | B)` to `(Obj & A) | (Obj & B)`.
- `z.discriminatedUnion('kind', [A, B])` — bare union of object types.
- `z.union([A, B])` — same.
- `A.and(z.union([…]))` — equivalent to the intersection-of-union form via Zod's `.and()`.

The fix is to skip class wrapping entirely. Use the schema directly for validation, and use the new method-level decorators (`@ZodBody`, `@ZodQuery`, `@ZodHeaders`, `@ZodCookies`) to wire OpenAPI doc emission. The handler argument keeps its precise `z.infer<>` type — no class-base lie, no `never` collapse on discriminants.

## Pattern

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ZodBody, ZodValidationPipe } from 'zod-nest';
import { z } from 'zod';

const IntersectionWithUnion = z
  .intersection(
    z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
    z.union([z.object({ c: z.string() }), z.object({ d: z.string() })]),
  )
  .meta({ id: 'IntersectionWithUnion' });

type IntersectionWithUnionType = z.infer<typeof IntersectionWithUnion>;

@Controller()
export class Controller {
  @Post()
  @ZodBody(IntersectionWithUnion)
  async post(
    @Body(new ZodValidationPipe(IntersectionWithUnion))
    body: IntersectionWithUnionType,
  ): Promise<IntersectionWithUnionType> {
    return body;
  }
}
```

What each piece does:

- `.meta({ id: 'IntersectionWithUnion' })` — names the schema. `@ZodBody` registers it in the registry under that id so `applyZodNest`'s bulk-emit pass writes its JSON Schema body to `components.schemas.IntersectionWithUnion`.
- `@ZodBody(schema)` — applies `@ApiBody({ schema: { $ref: '#/components/schemas/IntersectionWithUnion' } })` to the handler, so the OpenAPI doc references the schema correctly.
- `@Body(new ZodValidationPipe(schema))` — validates the request body at runtime. The pipe accepts a bare `z.ZodType` (no class wrapping required).
- `body: IntersectionWithUnionType` — TypeScript sees the precise inferred type. Use `z.infer<typeof Schema>` as the param annotation.

The schema is named once (the `const` declaration), and referenced at the decorator, the pipe, and the type position. There's no class to extend — no TS2509.

## Anonymous schemas (no `.meta({ id })`)

If you don't give the schema an id, `@ZodBody` inlines the JSON Schema body directly into the operation's `requestBody.content.application/json.schema`. The schema is not added to `components.schemas` (nothing to ref). This is fine for one-off bodies but means the schema isn't reusable across operations.

```ts
@Post()
@ZodBody(z.intersection(/* … */))  // anonymous — inline JSON Schema body
async post(/* … */): /* … */ {}
```

## Query / Headers / Cookies — per-property expansion

`@ZodQuery`, `@ZodHeaders`, and `@ZodCookies` work the same way but expand the schema's top-level properties into one OpenAPI parameter each. They require `z.object(...)` — non-object schemas (intersections, unions, primitives) can't be represented as a flat list of named parameters and will throw `ZodNestError` at decoration time.

```ts
const TemplatesQuery = z
  .object({
    limit: z.number().int().positive().optional(),
    cursor: z.string().optional(),
  })
  .meta({ id: 'TemplatesQuery' });

@Controller('templates')
export class TemplatesController {
  @Get()
  @ZodQuery(TemplatesQuery)
  list(
    @Query(new ZodValidationPipe(TemplatesQuery))
    q: z.infer<typeof TemplatesQuery>,
  ): unknown {
    return q;
  }
}
```

Optionality on each property maps to OpenAPI `required: false`. Named property schemas (each property with its own `.meta({ id })`) become `$ref`s in the parameter; anonymous property schemas inline.

## Swagger UI + `multipart/form-data` — `flatten: true`

`@ZodBody` defaults to the most semantic emission: a `$ref` to `components.schemas[<id>]`, with `z.intersection(A, B)` rendered as `{ allOf: [{ $ref: A }, { $ref: B }] }`. Downstream codegen tools and most OpenAPI viewers handle this fine.

**Swagger UI's `try-it-out` form generator for `multipart/form-data` does not.** It needs a flat `{ type: 'object', properties: {...} }` literal at the operation's `schema` site — it won't follow `$ref` and won't unwrap `allOf`. A file-upload endpoint whose body is `z.intersection(CandidateInput, ReferenceInput)` renders a single stub field instead of the actual form inputs (file pickers, array inputs, etc.).

Opt into flattening with `flatten: true`:

```ts
const CreateTaxonomyTranslation = z.intersection(
  CandidateInputSchema,
  ReferenceInputSchema,
);

@Controller('taxonomy-translations')
export class TaxonomyTranslationController {
  @Post()
  @ZodBody(CreateTaxonomyTranslation, { flatten: true })
  async create(
    @Body(new ZodValidationPipe(CreateTaxonomyTranslation))
    body: z.infer<typeof CreateTaxonomyTranslation>,
  ) {
    /* ... */
  }
}
```

What it does:

- Walks the schema, collecting every `z.object` leaf reachable through intersections and/or unions. Merges all collected shapes into a single anonymous `z.object` and emits it **inline** into the operation's request body — no `$ref`, no `allOf`, no `oneOf` at the operation level.
- Per-property `.meta({ id })` schemas keep their normal `$ref` emission (e.g. `candidate_trafficking: FileSchema` still refs `#/components/schemas/File`). Only the *root* is flattened.
- Property collisions resolve right-arm-wins, mirroring `z.object({ ...Left.shape, ...Right.shape })`.
- If the root itself has a `.meta({ id })`, the schema is **also** registered with its id and lands in `components.schemas[id]` in its *natural* (non-flattened) form (`allOf` / `oneOf`). The operation body stays flat; the schema catalog gets the structural composition. Both forms coexist.

Supported shapes:

- `z.object({...})` — no-op (already flat).
- `z.intersection(obj, obj)` — pure intersection of objects; merged with `required` preserved per-property.
- Nested intersections, e.g. `z.intersection(z.intersection(A, B), C)`.
- `z.union([obj, obj, ...])` / `z.discriminatedUnion(...)` — all variant shapes merged. **Every property becomes optional** in the emitted spec because no single field is guaranteed across the original variants.
- `z.intersection(union(...), union(...))` — the user's canonical case (taxonomy translation, e.g.). Combines the above; anything reachable through a union is optional in the result.

Trade-off when union arms are present: the emitted spec is *less precise* than the original schema. "Must supply variant A or variant B" becomes "any subset of A's and B's fields is allowed at the spec level." Runtime validation via `@Body(new ZodValidationPipe(originalSchema))` still enforces the precise variant shape — the precision loss is doc-only.

Rejected shapes: any non-object leaf at any depth (primitives, tuples, transforms, nullable wrappers around non-objects). `flatten: true` throws `ZodNestError` with a clear remediation pointer.

When to use it:

- The endpoint's content type is `multipart/form-data` (file uploads, mixed binary + JSON fields) AND
- You want Swagger UI's "Try it out" form to render the field inputs.

When to skip it:

- JSON-only endpoints — keep the default (`flatten: false`) to retain the structural composition in the doc.
- Schemas with non-object leaves — `flatten: true` will throw.

This is a Swagger-UI compatibility escape hatch, not a general recommendation. Trade-off: for union-bearing schemas the spec at the operation level is less restrictive than the actual runtime validation. (The named root in `components.schemas`, when `.meta({ id })` is present, still carries the precise composition.)

## When to use `createZodDto` vs. these decorators

| Schema shape | Recommended approach |
|---|---|
| `z.object({…})` (no inner unions) | `createZodDto(schema)` — full class ergonomics, sibling `Output` class, `parse`/`safeParse` statics |
| `z.intersection(obj1, obj2)` (no unions) | `createZodDto(schema)` — collapses to a single object intersection, class extension works |
| `z.intersection(obj, union)` | `@ZodBody(schema)` + `ZodValidationPipe` + `z.infer<>` |
| `z.discriminatedUnion(...)` | `@ZodBody(schema)` + `ZodValidationPipe` + `z.infer<>` |
| `z.union([...])` | `@ZodBody(schema)` + `ZodValidationPipe` + `z.infer<>` |

If you're unsure, try `createZodDto` first — when it fails with TS2509, fall back to the decorator pattern.
