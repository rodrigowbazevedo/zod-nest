import type { SchemaObject } from './openapi.types.js';

import { COMPONENTS_SCHEMAS_PREFIX, DEFS_PREFIX } from './constants.js';

export interface PostProcessResult {
  schema: SchemaObject;
  refs: Map<string, SchemaObject>;
}

const rewriteRefs = (node: unknown, selfRef: string | undefined): void => {
  if (Array.isArray(node)) {
    for (const item of node) {
      rewriteRefs(item, selfRef);
    }
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const obj = node as Record<string, unknown>;
  const ref = obj.$ref;
  if (typeof ref === 'string' && ref.startsWith(DEFS_PREFIX)) {
    obj.$ref = COMPONENTS_SCHEMAS_PREFIX + ref.slice(DEFS_PREFIX.length);
  } else if (ref === '#' && selfRef !== undefined) {
    // Zod emits '#' for cycle refs back to the document root. When we lift a
    // named schema into its own components.schemas entry, '#' should resolve
    // to that entry's own URI.
    obj.$ref = selfRef;
  }
  for (const value of Object.values(obj)) {
    rewriteRefs(value, selfRef);
  }
};

export const postProcess = (raw: SchemaObject): PostProcessResult => {
  const refs = new Map<string, SchemaObject>();
  const rawDefs = raw.$defs;
  if (rawDefs !== undefined) {
    for (const [id, body] of Object.entries(rawDefs)) {
      refs.set(id, body);
    }
  }

  const root: SchemaObject = { ...raw };
  delete root.$schema;
  delete root.$defs;

  // Root has no own self-uri at the 2a level. If the root is a bare `$ref` to a
  // lifted named schema (the common case when input itself has `.meta({ id })`),
  // we'll have already rewritten it to '#/components/schemas/<id>'.
  rewriteRefs(root, undefined);

  for (const [id, body] of refs) {
    rewriteRefs(body, `${COMPONENTS_SCHEMAS_PREFIX}${id}`);
  }

  return { schema: root, refs };
};
