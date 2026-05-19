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

## When to use `createZodDto` vs. these decorators

| Schema shape | Recommended approach |
|---|---|
| `z.object({…})` (no inner unions) | `createZodDto(schema)` — full class ergonomics, sibling `Output` class, `parse`/`safeParse` statics |
| `z.intersection(obj1, obj2)` (no unions) | `createZodDto(schema)` — collapses to a single object intersection, class extension works |
| `z.intersection(obj, union)` | `@ZodBody(schema)` + `ZodValidationPipe` + `z.infer<>` |
| `z.discriminatedUnion(...)` | `@ZodBody(schema)` + `ZodValidationPipe` + `z.infer<>` |
| `z.union([...])` | `@ZodBody(schema)` + `ZodValidationPipe` + `z.infer<>` |

If you're unsure, try `createZodDto` first — when it fails with TS2509, fall back to the decorator pattern.
