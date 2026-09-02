# Recipe: multipart uploads

Concrete migrations onto [`zod-nest/express`](../file-uploads.md#express--multer) and [`zod-nest/fastify`](../file-uploads.md#fastify--fastifymultipart). For the full API and the platform differences, start with [`docs/file-uploads.md`](../file-uploads.md).

## Replacing a hand-rolled `z.custom` file schema

The pattern this replaces — a local wrapper module that duck-types the multer shape and re-registers the binary fragment by hand:

```ts
// ❌ Before
import { binaryFragment, overrideJSONSchema } from 'zod-nest/helpers';

const MulterFileSchema = overrideJSONSchema(
  z.custom<Express.Multer.File>(
    (value) => typeof value === 'object' && value !== null && 'mimetype' in value,
  ),
  binaryFragment,
);

// Every constrained upload re-wraps, because .refine() clones the instance
// and the override is registered per-instance.
const CsvUpload = overrideJSONSchema(
  MulterFileSchema.refine((file) => file.mimetype === 'text/csv'),
  binaryFragment,
);
```

```ts
// ✅ After
import { multerMemoryFile } from 'zod-nest/express';

const CsvUpload = multerMemoryFile({ mimeTypes: ['text/csv'], extensions: ['csv'] });
```

The factory applies the checks and registers the fragment on both the base and the checked instance, so the emitted schema stays `{ type: 'string', format: 'binary' }` instead of collapsing to `{}` and tripping `ZodNestUnrepresentableError` in strict mode.

Hand-writing the schema still works — `overrideJSONSchema(schema.refine(...), binary())` is a supported idiom, and it's what you'd reach for with a parser this library doesn't model. The factory just removes the step people forget.

## Replacing `ParseFilePipe`

```ts
// ❌ Before — three decorators, and the constraints appear nowhere in the doc
@Post('avatar')
@UseInterceptors(FileInterceptor('avatar'))
@ApiConsumes('multipart/form-data')
@ApiBody({ schema: { type: 'object', properties: { avatar: { type: 'string', format: 'binary' } } } })
upload(
  @UploadedFile(
    new ParseFilePipe({
      validators: [
        new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
        new FileTypeValidator({ fileType: 'image/png' }),
      ],
    }),
  )
  avatar: Express.Multer.File,
) {}
```

```ts
// ✅ After — the constraints are the documentation
@Post('avatar')
@UseInterceptors(FileInterceptor('avatar'))
@ZodMultipart({
  avatar: multerMemoryFile({ maxSize: 2 * 1024 * 1024, mimeTypes: ['image/png'] }),
})
upload(@ZodUploadedFile('avatar') avatar: MulterMemoryFileLike) {}
```

Failures arrive as `ZodValidationException` with the usual issue array, rather than `ParseFilePipe`'s flat string message.

**Keep `FileTypeValidator` when the file type is a security boundary.** It sniffs magic numbers via the `file-type` package; `mimeTypes` only matches the header the client sent. Pass it as a pipe on the same decorator — `@ZodUploadedFile` accepts pipes like any Nest param decorator, so `zod-nest` documents and shape-checks while `ParseFilePipe` verifies the bytes:

```ts
@Post('avatar')
@UseInterceptors(FileInterceptor('avatar'))
@ZodMultipart({ avatar: multerMemoryFile({ maxSize: 2 * 1024 * 1024 }) })
upload(
  @ZodUploadedFile(
    'avatar',
    new ParseFilePipe({ validators: [new FileTypeValidator({ fileType: 'image/png' })] }),
  )
  avatar: MulterMemoryFileLike,
) {}
```

The Zod schema runs first, then the pipe. Don't stack a second param decorator (`@UploadedFile`) on the same parameter — Nest keys route-arg metadata by parameter index, so one silently overwrites the other.

## Mixing files with a typed text payload

Multipart text fields are always strings. Declare the coercion once and both the document and the handler are right:

```ts
@Post('import')
@UseInterceptors(FileInterceptor('sheet'))
@ZodMultipart({
  sheet: multerMemoryFile({ extensions: ['csv', 'tsv'] }),
  dryRun: z.stringbool(),
  batchSize: z.coerce.number().int().min(1).max(1000),
  label: z.string().min(1),
})
import(
  @ZodUploadedFile('sheet') sheet: MulterMemoryFileLike,
  @ZodMultipartBody() body: { dryRun: boolean; batchSize: number; label: string },
) {
  return this.importer.run(sheet.buffer, body);
}
```

`z.stringbool()` rather than `z.coerce.boolean()` — the latter maps the string `'false'` to `true`.

## Optional files

`.optional()` preserves the binary emission and drops the field from `required`:

```ts
@ZodMultipart({
  avatar: multerMemoryFile().optional(),
  name: z.string(),
})
```

The handler param is then `MulterMemoryFileLike | undefined`; `@ZodUploadedFile('avatar')` resolves `undefined` without throwing when no file was sent.

## A composite body (intersection of unions)

An endpoint that accepts *either* a set of files *or* a set of text fields, on each of two axes, is an intersection of unions — a shape no flat record can express. Pass the schema and flatten it:

```ts
const CandidateFiles = z.object({
  candidate_trafficking: Csv,
  candidate_list_values: Csv.optional(),
});
const CandidateTemplates = z.object({
  candidate_templates: z.string().nonempty(),
});

const CreateTaxonomyTranslation = z.intersection(
  z.union([CandidateTemplates, CandidateFiles]),
  z.union([ReferenceTemplates, ReferenceFiles]),
);

@Post()
@UseInterceptors(AnyFilesInterceptor())
@ZodMultipart(CreateTaxonomyTranslation, { flatten: true })
create(
  @Body(new ZodValidationPipe(CreateTaxonomyTranslation))
  body: z.infer<typeof CreateTaxonomyTranslation>,
) {}
```

Two things to know:

- **Every merged property is optional in the document.** No single property is guaranteed across the original variants, so the spec allows any subset. The `ZodValidationPipe` still enforces the real shape at runtime — the document is the lossy half, deliberately, so Swagger UI can render the form.
- **The multipart param decorators don't apply here.** They split a flat shape into file and text fields, and a composite has none, so they throw rather than guess. Use `@Body(new ZodValidationPipe(schema))`, as above.

## Sharing a file schema across endpoints

Nothing about these schemas is per-endpoint, so hoist the ones you reuse:

```ts
// upload-schemas.ts
export const ProfileImage = multerMemoryFile({
  maxSize: 2 * 1024 * 1024,
  mimeTypes: ['image/png', 'image/jpeg'],
  description: 'PNG or JPEG, 2 MB max',
});
```

The `description` rides along into every operation that uses it, so the constraint is stated once and documented everywhere.
