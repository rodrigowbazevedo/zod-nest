// Process-wide module state: each entry point is its own bundle, so a
// module-level WeakMap would exist once per bundle, and once per copy of
// the package in a consumer's tree.
const SINGLETONS = Symbol.for('zod-nest.singletons');

interface SingletonHost {
  [SINGLETONS]?: Map<string, unknown>;
}

// `globalThis` has no type for symbol keys and a Map's values are `unknown`.
// Both assertions live here so every call site stays cast-free.
const host = globalThis as SingletonHost;

const store = (): Map<string, unknown> => {
  const existing = host[SINGLETONS];
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, unknown>();
  host[SINGLETONS] = created;
  return created;
};

// Callers own the key namespace and are the only writers, so the stored
// type is theirs by construction. `create` must not return `undefined`.
export const singleton = <T>(key: string, create: () => T): T => {
  const values = store();
  const existing = values.get(key);
  if (existing !== undefined) {
    return existing as T;
  }
  const created = create();
  values.set(key, created);
  return created;
};
