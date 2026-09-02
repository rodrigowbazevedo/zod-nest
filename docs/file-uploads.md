# File uploads

`multipart/form-data` endpoints are the one place where the request the framework parses and the request the OpenAPI document describes genuinely disagree. The document sees one body — file fields and text fields together. The parser sees two things, and *which* two depends on which parser you run.

`zod-nest` ships a dedicated entry point per platform rather than one abstraction over both, because the two parsers differ in ways that can't be papered over honestly:

| | `zod-nest/express` (multer) | `zod-nest/fastify` (`@fastify/multipart`) |
| --- | --- | --- |
| Where files land | `req.file` / `req.files` | `req.body`, with `attachFieldsToBody: true` |
| Where text fields land | `req.body` | `req.body` |
| Client filename | `originalname` | `filename` |
| Bytes | `buffer` (memory storage) or `path` (disk storage) | `toBuffer(): Promise<Buffer>` |
| Reported size | `size` | none — it's still a stream |
| Size validation | `maxSize` option | not possible; use `limits.fileSize` |

Import from the entry point that matches your platform adapter. The wrong one won't quietly half-work: the shapes reject each other at runtime.

---

## Express + multer

### The whole endpoint

```ts
import { Controller, Post, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';

import type { MulterMemoryFileLike } from 'zod-nest/express';

import {
  multerMemoryFile,
  ZodMultipart,
  ZodMultipartBody,
  ZodUploadedFile,
} from 'zod-nest/express';

@Controller('users')
export class UsersController {
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  @ZodMultipart({
    avatar: multerMemoryFile({
      maxSize: 2 * 1024 * 1024,
      mimeTypes: ['image/png', 'image/jpeg'],
      description: 'Profile picture, 2 MB max',
    }),
    name: z.string().min(1),
    age: z.coerce.number().int(),
  })
  uploadAvatar(
    @ZodUploadedFile('avatar') avatar: MulterMemoryFileLike,
    @ZodMultipartBody() body: { name: string; age: number },
  ) {
    return { bytes: avatar.buffer.length, ...body };
  }
}
```

`@ZodMultipart` declares the body once and is the single source of truth. It emits the `requestBody`, sets `multipart/form-data` as the consumed type, and supplies the schemas the three param decorators validate against — so the file's constraints are never written twice.

The emitted operation:

```jsonc
{
  "requestBody": {
    "required": true,
    "content": {
      "multipart/form-data": {
        "schema": {
          "type": "object",
          "properties": {
            "avatar": {
              "type": "string",
              "format": "binary",
              "description": "Profile picture, 2 MB max"
            },
            "name": { "type": "string", "minLength": 1 },
            "age": { "type": "integer" }
          },
          "required": ["avatar", "name", "age"]
        }
      }
    }
  }
}
```

### Choosing a storage shape

Multer's file object depends on the storage engine, so there are two shapes rather than one with optional fields:

```ts
import { multerDiskFile, multerMemoryFile } from 'zod-nest/express';

multerMemoryFile(); // { fieldname, originalname, encoding, mimetype, size, buffer }
multerDiskFile();   // { fieldname, originalname, encoding, mimetype, size, destination, filename, path }
```

`MulterMemoryFileLike.buffer` is `Buffer`, not `Buffer | undefined` — no narrowing at every read site. The trade-off is that you pick the shape that matches your `MulterModule` configuration; a disk-storage file fails a `multerMemoryFile()` schema at runtime, which is the intended signal.

`MulterMemoryFileSchema` and `MulterDiskFileSchema` are the zero-option presets, for fields that need no per-field checks.

### Multiple files

`FilesInterceptor` and `AnyFilesInterceptor` put an array on `req.files`:

```ts
@Post('photos')
@UseInterceptors(FilesInterceptor('photos', 3))
@ZodMultipart({
  photos: z.array(multerMemoryFile({ mimeTypes: ['image/png'] })).max(3),
  album: z.string(),
})
upload(
  @ZodUploadedFiles('photos') photos: MulterMemoryFileLike[],
  @ZodMultipartBody() body: { album: string },
) {}
```

`FileFieldsInterceptor` puts a record keyed by field name there instead. Call `@ZodUploadedFiles()` with no name to validate the whole record against every file property you declared:

```ts
@Post('branding')
@UseInterceptors(
  FileFieldsInterceptor([{ name: 'logo', maxCount: 1 }, { name: 'banner', maxCount: 1 }]),
)
@ZodMultipart({
  logo: z.array(multerMemoryFile()),
  banner: z.array(multerMemoryFile()),
})
upload(
  @ZodUploadedFiles() files: { logo: MulterMemoryFileLike[]; banner: MulterMemoryFileLike[] },
) {}
```

### Why not `@UploadedFile('avatar')`

Nest's own decorator resolves its argument as a **request property**, not a form field — `RouteParamsFactory` reads `req[data ?? 'file']`, so `@UploadedFile('avatar')` returns `req.avatar`, which is `undefined`. There is no per-field extraction in Nest at all; `@UploadedFiles()` hands you the whole `req.files` to index yourself.

`@ZodUploadedFile('avatar')` reads `req.file` — exactly what Nest reads — and uses the name to select which property of your declared shape to validate against. It doesn't search the request either. Keeping the name equal to your `FileInterceptor('avatar')` field name is still your job; the gain is that the param name and the documented property name are now the same string.

---

## Fastify + `@fastify/multipart`

Register the plugin with `attachFieldsToBody: true` so files arrive in the body:

```ts
await app.register(fastifyMultipart, {
  attachFieldsToBody: true,
  limits: { fileSize: 2 * 1024 * 1024 },
});
```

Then one decorator covers the whole body, files included:

```ts
import { Controller, Post } from '@nestjs/common';
import { z } from 'zod';

import type { FastifyMultipartFileLike } from 'zod-nest/fastify';

import { fastifyMultipartFile, ZodMultipart, ZodMultipartBody } from 'zod-nest/fastify';

@Controller('documents')
export class DocumentsController {
  @Post()
  @ZodMultipart({
    document: fastifyMultipartFile({ mimeTypes: ['application/pdf'] }),
    title: z.string().min(1),
  })
  async upload(
    @ZodMultipartBody() body: { document: FastifyMultipartFileLike; title: string },
  ) {
    const bytes = await body.document.toBuffer();
    return { title: body.title, size: bytes.length };
  }
}
```

There is no `@ZodUploadedFile` on this entry point. With the files in the body, `@ZodMultipartBody()` already covers them — exporting a request-reading decorator that could never find anything would be worse than omitting it.

---

## Naming a file schema

By default a file schema is inlined at each use site. Pass `id` to get a reusable `components.schemas` entry that every field `$ref`s instead:

```ts
const StoredCsv = multerMemoryFile({ mimeTypes: ['text/csv'], id: 'StoredCsv' });
```

```jsonc
// components.schemas
"StoredCsv": { "type": "string", "format": "binary", "contentMediaType": "text/csv" }

// every field that uses it
"candidate_trafficking": { "$ref": "#/components/schemas/StoredCsv" }
```

Use `id` rather than calling `.meta({ id })` on the returned schema. `.meta()` clones the instance, and `overrideJSONSchema` keys its fragment per-instance — so the fragment stays on the pre-`.meta()` instance and the named component emits **empty**:

```ts
// ❌ component emits { "title": "StoredCsv" } — the binary fragment is lost
multerMemoryFile({ mimeTypes: ['text/csv'] }).meta({ id: 'StoredCsv', title: 'StoredCsv' });

// ✅ the factory re-registers the fragment after naming
multerMemoryFile({ mimeTypes: ['text/csv'], id: 'StoredCsv' });
```

There is no `title` option to go with `id`. `overrideJSONSchema` replaces the emitted body outright and deliberately doesn't carry `title` into it, so one would be silently discarded — a named file component has no `title`, and no `$ref` sibling is generated for it. Use `description`, which *is* carried into the fragment.

The same applies to any schema you name by hand after an `overrideJSONSchema` — re-wrap it, as [`recipes/custom-openapi-overrides.md`](recipes/custom-openapi-overrides.md) describes. The `id` option exists so the file helpers don't make you think about it.

## Text fields are strings

Every non-file part of a multipart request arrives as a string, whichever parser you use. Declare the coercion in the shape and both halves stay correct — the document says `number`, the handler receives a `number`:

```ts
@ZodMultipart({
  file: multerMemoryFile(),
  age: z.coerce.number().int(),  // '36' → 36, emits { type: 'integer' }
  active: z.stringbool(),        // 'true' / 'false' → boolean
})
```

Use `z.stringbool()`, **not** `z.coerce.boolean()`. The latter is `Boolean(value)`, so the string `'false'` becomes `true` — every checkbox in your form would read as checked.

---

## Limitations

Each of these is a property of the parser or of Nest, not an omission we intend to close.

**`maxSize` runs after the file is buffered.** Multer has already read the upload by the time a Zod check sees `size`. Treat the option as documentation plus defence in depth; the guard that actually stops a large upload is multer's own `limits.fileSize`:

```ts
MulterModule.register({ limits: { fileSize: 2 * 1024 * 1024 } });
```

**Fastify has no `maxSize` option at all.** A `MultipartFile` reports no size before its stream is read, so there is nothing to check. `fastifyMultipartFile` deliberately doesn't accept the option — the limit belongs in `limits.fileSize`.

**`mimeTypes` and `extensions` trust the client.** Both match the values the browser sent. They are not content sniffing. When the file type is a security boundary, use `@nestjs/common`'s `FileTypeValidator`, which checks magic numbers via the `file-type` package, or sniff the bytes yourself.

**Disk storage can't validate bytes.** `MulterDiskFileLike` has a `path`, not a `buffer`. Anything that needs the content has to read the file.

**`attachFieldsToBody: 'keyValues'` is unsupported.** That mode yields a third shape again (decoded values rather than `MultipartFile` objects). Only `true` is modelled.

**The multipart body is inline, not a `components.schemas` entry.** Swagger UI's try-it-out form generator doesn't follow `$ref` and doesn't unwrap `allOf`, so a referenced body renders as a single stub field instead of file pickers. `@ZodMultipart` always emits the body inline — the same trade-off [`@ZodBody({ flatten: true })`](recipes/intersection-with-union.md#swagger-ui--multipartform-data--flatten-true) documents.

**Module-level validation options don't reach the param decorators.** `@ZodUploadedFile`, `@ZodUploadedFiles`, and `@ZodMultipartBody` validate inside a Nest param factory, and param factories aren't resolved through the DI container. They always throw the default `ZodValidationException`, so `ZodNestModule.forRoot({ createValidationException, validationLogs })` does not apply to them. Everything else — `@Body()`, `@Query()`, `@ZodResponse` — is unaffected.

**Checks stop at the first failure.** A file breaking several constraints reports one issue, in declaration order: `mimeTypes`, then `extensions`, then `maxSize`.

---

## API

### `zod-nest/express`

| Export | Purpose |
| --- | --- |
| `multerMemoryFile(options?)` | Memory-storage file schema with optional checks |
| `multerDiskFile(options?)` | Disk-storage file schema with optional checks |
| `MulterMemoryFileSchema` / `MulterDiskFileSchema` | Zero-option presets |
| `MulterMemoryFileLike` / `MulterDiskFileLike` | Structural types for handler params |
| `MulterFileOptions` | `{ id?, maxSize?, mimeTypes?, extensions?, description?, contentMediaType? }` |
| `@ZodMultipart(shape, options?)` | Declares the body; emits `requestBody` + `multipart/form-data` |
| `@ZodUploadedFile(name)` | Validates `req.file` against `shape[name]` |
| `@ZodUploadedFiles(name?)` | Validates `req.files` against `shape[name]`, or all file properties |
| `@ZodMultipartBody()` | Validates `req.body` against the text properties |

### `zod-nest/fastify`

| Export | Purpose |
| --- | --- |
| `fastifyMultipartFile(options?)` | `MultipartFile` schema with optional checks |
| `FastifyMultipartFileSchema` | Zero-option preset |
| `FastifyMultipartFileLike` | Structural type for handler params |
| `FastifyMultipartFileOptions` | `{ id?, mimeTypes?, extensions?, description?, contentMediaType? }` — no `maxSize` |
| `@ZodMultipart(shape, options?)` | Declares the body; defaults to `filesIn: 'body'` |
| `@ZodMultipartBody()` | Validates `req.body` against the whole shape, files included |

### Shared by both

| Export | Purpose |
| --- | --- |
| `ZodMultipartOptions` | `{ filesIn?, registry?, description?, required? }` — the second argument to `@ZodMultipart` |
| `MultipartShape` | `Readonly<Record<string, z.ZodType>>` — the shape argument, for hoisting a shared declaration |
| `MULTIPART_CONTENT_TYPE` | `'multipart/form-data'`, the key `@ZodMultipart` emits the body under |

`description` and `required` land on the OpenAPI `requestBody`; `registry` scopes named descendants the way it does elsewhere. `filesIn` defaults to `'request'` from `zod-nest/express` and `'body'` from `zod-nest/fastify` — override it only if you've configured a parser against its platform's convention.

## See also

- [`recipes/multipart-uploads.md`](recipes/multipart-uploads.md) — replacing `ParseFilePipe`, migrating a hand-rolled `z.custom` schema
- [`swagger-integration.md`](swagger-integration.md) — how `overrideJSONSchema` powers the binary emission
- [`recipes/binary-downloads.md`](recipes/binary-downloads.md) — the response side
