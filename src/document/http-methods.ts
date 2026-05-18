import type { OpenAPIObject } from '@nestjs/swagger';

/** OpenAPI 3.1 operation methods, in spec order. */
export const HTTP_METHODS: readonly string[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

/**
 * Visits every `(pathItem, op)` pair in the doc, narrowed to plain records.
 * Centralises the defensive `paths → pathItem → op` walk that several
 * post-process passes need; callers that mutate `op` (e.g. swap
 * `op.parameters`) can do so in place.
 */
export const forEachOperation = (
  doc: OpenAPIObject,
  fn: (op: Record<string, unknown>) => void,
): void => {
  const paths = doc.paths;
  if (paths === null || typeof paths !== 'object') {
    return;
  }
  for (const pathItem of Object.values(paths)) {
    if (pathItem === null || typeof pathItem !== 'object') {
      continue;
    }
    const pathRecord = pathItem as Record<string, unknown>;
    for (const method of HTTP_METHODS) {
      const op = pathRecord[method];
      if (op === null || typeof op !== 'object') {
        continue;
      }
      fn(op as Record<string, unknown>);
    }
  }
};
