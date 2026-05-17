import type { z } from 'zod';
import type { Io, ZodDto } from './dto.types.js';

import { ZOD_NEST_DTO_EXTENSION } from '../schema/constants.js';
import { ZOD_DTO_SYMBOL } from './symbols.js';

/**
 * Cache of `parent -> output-sibling` so repeated reads of `Dto.Output` return
 * the same class instance. WeakMap so the sibling can be GC'd if the parent is.
 */
const outputCache = new WeakMap<ZodDto<z.ZodType>, ZodDto<z.ZodType>>();

/**
 * `.Output` is always a distinct sibling class — it carries `io: 'output'` so
 * the Phase 2e doc-merger can run the output-side emission and apply the
 * suffix truth table (`Foo` alone vs `Foo` + `FooOutput`) based on actual JSON
 * Schema equality at doc-build time. The earlier "return self when io-identical"
 * optimization was dropped because `z.object()` already diverges at the JSON
 * Schema level (input is permissive, output sets `additionalProperties: false`),
 * which would have made the sibling reused only for non-object roots — not
 * worth the implementation complexity.
 */
const buildSiblingClass = <TSchema extends z.ZodType>(
  parent: ZodDto<TSchema>,
  schema: TSchema,
): ZodDto<TSchema> => {
  const SiblingClass = class {
    static readonly schema = schema;
    static readonly io: Io = 'output';
    static readonly [ZOD_DTO_SYMBOL] = true as const;

    static get id(): string {
      return parent.id;
    }

    static get Output(): ZodDto<TSchema> {
      return this as unknown as ZodDto<TSchema>;
    }

    static parse(input: unknown): z.infer<TSchema> {
      return schema.parse(input) as z.infer<TSchema>;
    }

    static safeParse(input: unknown): z.ZodSafeParseResult<z.infer<TSchema>> {
      return schema.safeParse(input) as z.ZodSafeParseResult<z.infer<TSchema>>;
    }

    static _OPENAPI_METADATA_FACTORY(): Record<string, unknown> {
      return {
        [ZOD_NEST_DTO_EXTENSION]: {
          // Mirror parent's factory shape — see comment in create-zod-dto.ts.
          type: () => Object,
          required: false,
          __zodNestDto: true,
          dtoId: parent.id,
          io: 'output',
        },
      };
    }
  };
  return SiblingClass as unknown as ZodDto<TSchema>;
};

export const resolveOutput = <TSchema extends z.ZodType>(
  parent: ZodDto<TSchema>,
  schema: TSchema,
): ZodDto<TSchema> => {
  const cached = outputCache.get(parent as ZodDto<z.ZodType>);
  if (cached !== undefined) {
    return cached as ZodDto<TSchema>;
  }
  const sibling = buildSiblingClass(parent, schema);
  outputCache.set(parent as ZodDto<z.ZodType>, sibling as ZodDto<z.ZodType>);
  return sibling;
};
