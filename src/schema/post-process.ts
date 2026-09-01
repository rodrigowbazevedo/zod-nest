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

const refsIn = function* (node: unknown): Generator<string> {
  if (Array.isArray(node)) {
    for (const item of node) {
      yield* refsIn(item);
    }
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === 'string') {
    yield obj.$ref;
  }
  for (const value of Object.values(obj)) {
    yield* refsIn(value);
  }
};

const rootDefId = (raw: SchemaObject): string | undefined => {
  const ref = raw.$ref;
  if (typeof ref !== 'string' || !ref.startsWith(DEFS_PREFIX)) {
    return undefined;
  }
  return ref.slice(DEFS_PREFIX.length);
};

const isReferenced = (defs: SchemaObject['$defs'], id: string): boolean => {
  const ownRef = `${DEFS_PREFIX}${id}`;
  for (const ref of refsIn(defs)) {
    if (ref === '#' || ref === ownRef) {
      return true;
    }
  }
  return false;
};

// Zod 4.5 lifts every named root into `$defs` and leaves a bare `$ref`; 4.4 only
// did so for recursive schemas. Inline it back unless something refs the entry.
const liftRoot = (raw: SchemaObject, refs: Map<string, SchemaObject>): SchemaObject | undefined => {
  const id = rootDefId(raw);
  if (id === undefined) {
    return undefined;
  }
  const body = refs.get(id);
  if (body === undefined || isReferenced(raw.$defs, id)) {
    return undefined;
  }
  refs.delete(id);
  return body;
};

const stripEnvelope = (raw: SchemaObject): SchemaObject => {
  const root: SchemaObject = { ...raw };
  delete root.$schema;
  delete root.$defs;
  return root;
};

export const postProcess = (raw: SchemaObject): PostProcessResult => {
  const refs = new Map<string, SchemaObject>();
  const rawDefs = raw.$defs;
  if (rawDefs !== undefined) {
    for (const [id, body] of Object.entries(rawDefs)) {
      refs.set(id, body);
    }
  }

  const root = liftRoot(raw, refs) ?? stripEnvelope(raw);
  rewriteRefs(root, undefined);

  for (const [id, body] of refs) {
    rewriteRefs(body, `${COMPONENTS_SCHEMAS_PREFIX}${id}`);
  }

  return { schema: root, refs };
};
