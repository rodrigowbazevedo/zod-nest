# Recipe: Recursive schemas

Self-referential schemas (a tree node containing children of the same shape, a comment that can have replies) work in Zod via lazy references. `zod-nest` carries them through to OpenAPI as `$ref` cycles back to the schema's own `components.schemas` entry.

## The basic shape

Use `z.lazy(() => ...)` to break the circular reference at definition time, and `.meta({ id })` so the cycle has a stable name to refer back to:

```ts
import { z } from 'zod';
import { createZodDto } from 'zod-nest';

interface CommentShape {
  id: string;
  body: string;
  replies: CommentShape[];
}

const commentSchema: z.ZodType<CommentShape> = z
  .lazy(() =>
    z.object({
      id: z.string(),
      body: z.string(),
      replies: z.array(commentSchema),
    }),
  )
  .meta({ id: 'Comment' });

class CommentDto extends createZodDto(commentSchema) {}
```

The `z.ZodType<CommentShape>` annotation gives TypeScript the recursive interface; the runtime cycle is handled by `z.lazy`. The `.meta({ id: 'Comment' })` at the top ensures the OpenAPI emission has a stable target for the back-reference.

## OpenAPI emission

The emitted schema for `Comment` is:

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "body": { "type": "string" },
    "replies": {
      "type": "array",
      "items": { "$ref": "#/components/schemas/Comment" }
    }
  },
  "required": ["id", "body", "replies"]
}
```

The `items` ref points back to the schema's own `components.schemas` entry — a clean cycle that Swagger UI handles without trouble.

## Mutually recursive schemas

Two schemas that reference each other (A contains B, B contains A) follow the same pattern:

```ts
interface AShape {
  name: string;
  bs: BShape[];
}
interface BShape {
  code: number;
  a: AShape;
}

const aSchema: z.ZodType<AShape> = z
  .lazy(() =>
    z.object({
      name: z.string(),
      bs: z.array(bSchema),
    }),
  )
  .meta({ id: 'A' });

const bSchema: z.ZodType<BShape> = z
  .lazy(() =>
    z.object({
      code: z.number(),
      a: aSchema,
    }),
  )
  .meta({ id: 'B' });

class ADto extends createZodDto(aSchema) {}
class BDto extends createZodDto(bSchema) {}
```

Both DTOs get their own `components.schemas` entry with `$ref`s pointing at each other.

## Tree-shaped schemas

For a generic tree (any node can have children of the same shape):

```ts
interface TreeNode<T> {
  value: T;
  children: TreeNode<T>[];
}

const userTreeSchema: z.ZodType<TreeNode<string>> = z
  .lazy(() =>
    z.object({
      value: z.string(),
      children: z.array(userTreeSchema),
    }),
  )
  .meta({ id: 'UserTree' });
```

Generic recursive shapes work in TS but only one concrete instantiation can register under a given id — `UserTree` here. If you need both `TreeNode<string>` and `TreeNode<number>` in the same OpenAPI doc, register them under separate ids (`UserTree` + `RatingTree`).

## What doesn't work

- **Discriminated unions inside recursion** — Zod requires the discriminator key to be resolvable at schema-construction time, which breaks under `z.lazy`. Model these as `z.union` with a `.refine` instead.
- **Composition (`extend`) on a recursive schema** — the lineage layer expects a concrete `z.ZodObject`, which `z.lazy` doesn't expose directly. Compose first, then wrap in `z.lazy` only if the result itself is recursive.
- **Recursive schemas without `.meta({ id })`** — without an id, the back-reference has no stable target. The emission falls back to inlining the body once and then producing a schema cycle the JSON Schema validators can't resolve.

## Async refinement on recursive schemas

Validation works with `safeParseAsync`, so a recursive schema with an async refinement on a sub-node is fine at request time:

```ts
const commentSchema: z.ZodType<CommentShape> = z
  .lazy(() =>
    z.object({
      id: z.string().refine(async (id) => await isValidId(id)),
      body: z.string(),
      replies: z.array(commentSchema),
    }),
  )
  .meta({ id: 'Comment' });
```

The pipe uses `safeParseAsync`, so the chain of async refinements through the recursive structure runs naturally. Watch your refinement cost — a deep tree multiplies the per-request validation budget.

See [`docs/dto.md`](../dto.md) for the DTO surface and [`docs/validation-pipe.md`](../validation-pipe.md) for the pipe's async behaviour.
