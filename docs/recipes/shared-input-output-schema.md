# Recipe: Shared input/output schema via `.meta({ id })`

When a schema's input and output JSON Schemas are byte-equal, `zod-nest` collapses them into a single `components.schemas[id]` entry. When they diverge (transform, default, pipe), the output side gets lifted to `<id>Output` and response refs are rewritten. The split is automatic — you don't pick it with a flag.

## When they collapse

```ts
const userSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    age: z.number().int().nonnegative(),
  })
  .meta({ id: 'User' });

class UserDto extends createZodDto(userSchema) {}
```

Input JSON Schema and output JSON Schema are byte-equal (no transforms, no defaults). The doc has one entry:

```json
{ "components": { "schemas": { "User": { "type": "object", ... } } } }
```

Both `requestBody` and response `$ref`s point at `#/components/schemas/User`.

## When they split

```ts
const userSchema = z
  .object({
    id: z.uuid(),
    email: z.email().transform((v) => v.toLowerCase()),  // input string → output string (different shape upstream)
  })
  .meta({ id: 'User' });

class UserDto extends createZodDto(userSchema) {}
```

`z.email().transform(...)` produces different input vs output JSON Schemas (the input describes the pre-transform shape, the output describes the post-transform shape). The doc gets two entries:

```json
{
  "components": {
    "schemas": {
      "User":       { "type": "object", "properties": { "email": { "type": "string", "format": "email" }, ... } },
      "UserOutput": { "type": "object", "properties": { "email": { "type": "string" }, ... } }
    }
  }
}
```

Response refs are automatically rewritten to `#/components/schemas/UserOutput`. Request refs stay at `#/components/schemas/User`.

## Forcing a collapse with `.pipe`

If you want the response side to advertise the same schema as the request side — even when a transform is present — encode the transform asymmetry away from JSON Schema with `z.pipe`:

```ts
const trimmedString = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string());                  // post-pipe stage forces the output JSON Schema back to plain string

const userSchema = z
  .object({ name: trimmedString })
  .meta({ id: 'User' });
```

Now input and output schemas are both `{ type: 'string' }` and the doc collapses to a single `User` entry. The trim still runs at validation time — the client just doesn't see two flavors of the same schema in Swagger UI.

## Forcing a split when you want both shapes documented

There's no built-in flag for this. If the input and output JSON Schemas are byte-equal but you want them documented as two separate entries (perhaps because they evolve independently), give them two distinct ids and two distinct DTOs:

```ts
const userInputSchema  = z.object({ /* ... */ }).meta({ id: 'UserInput' });
const userOutputSchema = z.object({ /* ... */ }).meta({ id: 'UserOutput' });

class UserInputDto  extends createZodDto(userInputSchema)  {}
class UserOutputDto extends createZodDto(userOutputSchema) {}

@Post()
@ZodResponse({ type: UserOutputDto })
create(@Body() body: UserInputDto): UserOutputDto { /* ... */ }
```

This is rare. The default "collapse when equal, split when divergent" behaviour covers most cases.

## I/O sibling for advanced cases

`UserDto.Output` returns a sibling class that carries `io: 'output'`. The OpenAPI doc uses it automatically when emitting response schemas — you rarely need it directly.

Reach for it only when:
- You're building a custom interceptor that needs to introspect the output-side schema explicitly.
- You're writing a custom doc generator and want to peek at the post-transform JSON Schema.
- You're testing the I/O suffix truth table directly.

```ts
const inputBody  = UserDto.schema;            // input JSON Schema source
const outputBody = UserDto.Output.schema;     // output JSON Schema source — same Zod schema, different io tag
```

The Zod schema reference is identical — what differs is which side `applyZodNest` emits when introspecting the DTO class. See [`docs/dto.md → I/O sibling`](../dto.md#io-sibling).

## Verification in tests

If you want to assert the split behavior in tests:

```ts
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { applyZodNest } from 'zod-nest';

const raw = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('t').setVersion('1').build());
const doc = applyZodNest(raw, { app });

// Single entry — no divergence
expect(doc.components?.schemas).toHaveProperty('User');
expect(doc.components?.schemas).not.toHaveProperty('UserOutput');

// Or — two entries because of a transform
expect(doc.components?.schemas).toHaveProperty('User');
expect(doc.components?.schemas).toHaveProperty('UserOutput');
```

See [`docs/swagger-integration.md`](../swagger-integration.md) for the full I/O suffix truth table and the merge-pass behaviour.
