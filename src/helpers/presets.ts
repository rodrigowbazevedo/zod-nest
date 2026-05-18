import { z } from 'zod';

import { overrideJSONSchema } from '../schema/custom-override.js';
import { binaryFragment } from './fragments.js';

/**
 * Pre-registered Zod schemas for the common binary runtime types. Each
 * schema is wired through `overrideJSONSchema` so it emits `binaryFragment`
 * verbatim in OpenAPI — drop into a DTO without further setup.
 *
 * Node 22+ provides `File`, `Blob`, and `Buffer` as globals (zod-nest's
 * `engines.node >=22`), so `z.instanceof(...)` at module load is safe.
 *
 * @example
 * import { FileSchema } from 'zod-nest/helpers';
 *
 * class UploadDto extends createZodDto(
 *   z.object({ file: FileSchema }),
 * ) {}
 */

export const FileSchema = overrideJSONSchema(z.instanceof(File), binaryFragment);

export const BlobSchema = overrideJSONSchema(z.instanceof(Blob), binaryFragment);

export const BufferSchema = overrideJSONSchema(z.instanceof(Buffer), binaryFragment);
