import type { OpenAPIObject } from '@nestjs/swagger';

/** Path-item keys `@nestjs/swagger` emits: 3.1's fixed set plus the extension
 * methods NestJS routes — the explorer lowercases whatever `RequestMethod` names. */
export const HTTP_METHODS: readonly string[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
  'search',
  'propfind',
  'proppatch',
  'mkcol',
  'copy',
  'move',
  'lock',
  'unlock',
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
