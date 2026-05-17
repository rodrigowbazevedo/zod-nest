import type { z } from 'zod';
import type { ZodNestRegistry } from '../schema/registry.js';
import type { CreateZodDtoOptions, Io, ZodDto } from './dto.types.js';

import { ZOD_NEST_DTO_EXTENSION } from '../schema/constants.js';
import { defaultRegistry } from '../schema/registry.js';
import { makeZodDtoMarker } from './marker.js';
import { resolveOutput } from './output-dto.js';
import { ZOD_DTO_SYMBOL } from './symbols.js';

let anonCounter = 0;
let warnedOnAnonymous = false;

const resolveId = (
  registry: ZodNestRegistry,
  schema: z.ZodType,
  providedId: string | undefined,
  className: string,
): string => {
  if (providedId !== undefined && providedId !== '') {
    return providedId;
  }
  const meta = registry.zodRegistry.get(schema) as { id?: string } | undefined;
  if (meta && typeof meta.id === 'string' && meta.id !== '') {
    return meta.id;
  }
  if (className !== '' && className.length > 1) {
    return className;
  }
  anonCounter += 1;
  const fallback = `_AnonZodDto_${anonCounter}`;
  if (!warnedOnAnonymous) {
    warnedOnAnonymous = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[zod-nest] Could not resolve a DTO id from class name (got "${className}"). ` +
        `Using "${fallback}". Pass \`createZodDto(schema, { id: 'Foo' })\` to set a stable ` +
        `name — important under minification, where class names become single mangled characters.`,
    );
  }
  return fallback;
};

export const createZodDto = <TSchema extends z.ZodType>(
  schema: TSchema,
  options?: CreateZodDtoOptions,
): ZodDto<TSchema> => {
  const registry: ZodNestRegistry = options?.registry ?? defaultRegistry;
  const io: Io = 'input';
  let cachedId: string | undefined;

  const ensureRegistered = (className: string): string => {
    if (cachedId !== undefined) {
      return cachedId;
    }
    cachedId = resolveId(registry, schema, options?.id, className);
    registry.register(schema, cachedId);
    return cachedId;
  };

  const ZodDtoBase = class {
    static readonly schema = schema;
    static readonly io: Io = io;
    static readonly [ZOD_DTO_SYMBOL] = true as const;

    static get id(): string {
      return ensureRegistered(this.name);
    }

    static get Output(): ZodDto<TSchema> {
      return resolveOutput(this as unknown as ZodDto<TSchema>, schema);
    }

    static parse(input: unknown): z.infer<TSchema> {
      return schema.parse(input) as z.infer<TSchema>;
    }

    static safeParse(input: unknown): z.ZodSafeParseResult<z.infer<TSchema>> {
      return schema.safeParse(input) as z.ZodSafeParseResult<z.infer<TSchema>>;
    }

    static _OPENAPI_METADATA_FACTORY(): Record<string, unknown> {
      return { [ZOD_NEST_DTO_EXTENSION]: makeZodDtoMarker(ensureRegistered(this.name), io) };
    }
  };

  return ZodDtoBase as unknown as ZodDto<TSchema>;
};
