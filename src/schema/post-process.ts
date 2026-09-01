import type { SchemaObject } from './openapi.types.js';

import { COMPONENTS_SCHEMAS_PREFIX, DEFS_PREFIX } from './constants.js';
import { ZodNestError } from './errors.js';

export interface PostProcessResult {
  schema: SchemaObject;
  refs: Map<string, SchemaObject>;
}

export interface PostProcessOptions {
  /** Component id of the emitted root, when it has one. Resolves `'#'` refs. */
  rootId?: string;
  strict?: boolean;
}

// Zod emits '#' for a cycle back to the document root, so it resolves to the
// root's own component — never to whichever def happens to contain it.
const rewriteRefs = (node: unknown, rootRef: string | undefined): void => {
  if (Array.isArray(node)) {
    for (const item of node) {
      rewriteRefs(item, rootRef);
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
  } else if (ref === '#' && rootRef !== undefined) {
    obj.$ref = rootRef;
  }
  for (const value of Object.values(obj)) {
    rewriteRefs(value, rootRef);
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

const referencesRoot = (raw: SchemaObject): boolean => {
  for (const ref of refsIn(raw)) {
    if (ref === '#') {
      return true;
    }
  }
  return false;
};

const stripEnvelope = (raw: SchemaObject): SchemaObject => {
  const root: SchemaObject = { ...raw };
  delete root.$schema;
  delete root.$defs;
  return root;
};

interface ResolvedRoot {
  schema: SchemaObject;
  rootRef: string | undefined;
}

// A referenced root has to be addressable, so it keeps (or gains) a component
// entry and the caller gets a `$ref`. Inlining an unreferenced one keeps zod
// 4.4 and 4.5 emitting the same shape.
const resolveRoot = (
  raw: SchemaObject,
  refs: Map<string, SchemaObject>,
  options: PostProcessOptions | undefined,
): ResolvedRoot => {
  const liftedId = rootDefId(raw);
  if (liftedId !== undefined) {
    const body = refs.get(liftedId);
    if (body !== undefined && !isReferenced(raw.$defs, liftedId)) {
      refs.delete(liftedId);
      return { schema: body, rootRef: undefined };
    }
    return { schema: stripEnvelope(raw), rootRef: `${COMPONENTS_SCHEMAS_PREFIX}${liftedId}` };
  }

  const root = stripEnvelope(raw);
  if (!referencesRoot(raw)) {
    return { schema: root, rootRef: undefined };
  }

  const rootId = options?.rootId;
  if (rootId === undefined) {
    if (options?.strict ?? true) {
      throw new ZodNestError(
        'A schema referenced from inside its own emission has no id, so the reference ' +
          'cannot be resolved. Add `.meta({ id: "…" })` to the root schema, or set ' +
          'strict: false to leave the reference unresolved.',
      );
    }
    return { schema: root, rootRef: undefined };
  }

  refs.set(rootId, root);
  const rootRef = `${COMPONENTS_SCHEMAS_PREFIX}${rootId}`;
  return { schema: { $ref: rootRef }, rootRef };
};

export const postProcess = (raw: SchemaObject, options?: PostProcessOptions): PostProcessResult => {
  const refs = new Map<string, SchemaObject>();
  const rawDefs = raw.$defs;
  if (rawDefs !== undefined) {
    for (const [id, body] of Object.entries(rawDefs)) {
      refs.set(id, body);
    }
  }

  const { schema, rootRef } = resolveRoot(raw, refs, options);
  rewriteRefs(schema, rootRef);

  for (const body of refs.values()) {
    rewriteRefs(body, rootRef);
  }

  return { schema, refs };
};
