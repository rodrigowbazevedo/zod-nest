import type { OpenAPIObject } from '@nestjs/swagger';
import type { CollectedUsage } from './collect-usage.js';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';
import { ZodNestDocumentError } from './errors.js';
import { walkRefs } from './walk-refs.js';

export interface AssertNoDanglingRefsParams {
  doc: OpenAPIObject;
  collected: CollectedUsage;
}

/**
 * Final assertion pass over the doc. Walks every `$ref` and confirms that
 * any `#/components/schemas/<id>` target exists in `components.schemas`.
 * Throws `ZodNestDocumentError({ code: 'DANGLING_REF' })` listing all
 * offending refs with a per-ref hint inferred from `collected` — whether
 * the id was seen in input/output usage (suggests a registry mismatch) or
 * is otherwise unknown (likely a `meta.id` typo or unregistered DTO).
 *
 * Scoped to `#/components/schemas/` refs only — refs into other component
 * namespaces (`#/components/parameters/...`, `#/components/responses/...`)
 * are user-managed and not validated here.
 */
export const assertNoDanglingRefs = (params: AssertNoDanglingRefsParams): void => {
  const { doc, collected } = params;
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
  const lines = dangling.map((ref) => `  - ${ref} — ${hintFor(ref, collected)}`);
  throw new ZodNestDocumentError(
    'DANGLING_REF',
    `Found ${dangling.length} \`$ref\` target(s) that don't resolve to a ` +
      'schema in `components.schemas`. The most common cause is a `meta.id` ' +
      'typo on a DTO, a DTO used without `createZodDto`, or a `$ref` left ' +
      `behind by a pre-pass that mutated the doc before \`applyZodNest\`.\n${lines.join('\n')}`,
    { dangling },
  );
};

const hintFor = (ref: string, collected: CollectedUsage): string => {
  const id = ref.slice(COMPONENTS_SCHEMAS_PREFIX.length);
  const usedInput = collected.inputExposedIds.has(id);
  const usedOutput = collected.outputExposedIds.has(id);
  if (usedInput && usedOutput) {
    return 'used as input and output but body missing — DTO is registered under a different id';
  }
  if (usedInput) {
    return 'used as input but body missing — DTO is registered under a different id';
  }
  if (usedOutput) {
    return 'used as output but body missing — DTO is registered under a different id';
  }
  return 'no DTO with this id was registered — check for a meta.id typo or a DTO used without createZodDto';
};
