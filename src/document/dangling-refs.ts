import type { OpenAPIObject } from '@nestjs/swagger';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';
import { ZodNestDocumentError } from './errors.js';
import { walkRefs } from './walk-refs.js';

/**
 * Final assertion pass over the doc. Walks every `$ref` and confirms that
 * any `#/components/schemas/<id>` target exists in `components.schemas`.
 * Throws `ZodNestDocumentError({ code: 'DANGLING_REF' })` listing all
 * offending refs.
 *
 * Scoped to `#/components/schemas/` refs only — refs into other component
 * namespaces (`#/components/parameters/...`, `#/components/responses/...`)
 * are user-managed and not validated here.
 */
export const assertNoDanglingRefs = (doc: OpenAPIObject): void => {
  const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
  const dangling: string[] = [];
  walkRefs(doc, (ref) => {
    if (!ref.startsWith(COMPONENTS_SCHEMAS_PREFIX)) {
      return undefined;
    }
    const target = ref.slice(COMPONENTS_SCHEMAS_PREFIX.length);
    if (!(target in schemas)) {
      dangling.push(ref);
    }
    return undefined;
  });
  if (dangling.length === 0) {
    return;
  }
  throw new ZodNestDocumentError(
    'DANGLING_REF',
    `Found ${dangling.length} \`$ref\` target(s) that don't resolve to a ` +
      'schema in `components.schemas`. The most common cause is a `meta.id` ' +
      'typo on a DTO, a DTO used without `createZodDto`, or a `$ref` left ' +
      'behind by a pre-pass that mutated the doc before `applyZodNest`.',
    { dangling },
  );
};
