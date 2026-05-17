/**
 * Visitor invoked for every `{ $ref: string }` node encountered during
 * `walkRefs`. Return a new string to mutate the ref in place; return
 * `undefined` to leave it untouched.
 */
export type RefVisitor = (ref: string) => string | undefined;

/**
 * Deeply walks an OpenAPI sub-tree, invoking `visit` on every `$ref` string
 * value. Mutates the tree in place when the visitor returns a replacement.
 * Used by `rewrite-refs` (mutating) and `dangling-refs` (read-only).
 */
export const walkRefs = (node: unknown, visit: RefVisitor): void => {
  if (node === null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkRefs(item, visit);
    }
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (key === '$ref' && typeof value === 'string') {
      const next = visit(value);
      if (next !== undefined) {
        obj[key] = next;
      }
      continue;
    }
    walkRefs(value, visit);
  }
};
