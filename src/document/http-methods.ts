import type { OpenAPIObject } from '@nestjs/swagger';

/** Path-item keys that are operations in their own right: 3.1's fixed eight
 * plus `query`, which OpenAPI 3.2 promoted to a first-class field. */
export const OPENAPI_OPERATION_KEYS: readonly string[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
];

/** Methods NestJS routes that are path-item fields in no OpenAPI version. 3.2
 * takes them under `additionalOperations`; 3.1 has no conformant home. */
export const EXTENSION_OPERATION_KEYS: readonly string[] = [
  'search',
  'propfind',
  'proppatch',
  'mkcol',
  'copy',
  'move',
  'lock',
  'unlock',
];

/** Every key `@nestjs/swagger` can emit — the explorer lowercases whatever
 * `RequestMethod` names, so the walk is wider than any one spec version. */
export const HTTP_METHODS: readonly string[] = [
  ...OPENAPI_OPERATION_KEYS,
  ...EXTENSION_OPERATION_KEYS,
];

export const ADDITIONAL_OPERATIONS_KEY = 'additionalOperations';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/** Every operation on a path item: the flat method keys plus `additionalOperations`
 * values, which are Operation Objects carrying `$ref`s the walks must see. */
export const operationsOfPathItem = (
  pathItem: Record<string, unknown>,
): Record<string, unknown>[] => {
  const operations: Record<string, unknown>[] = [];
  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    if (isRecord(operation)) {
      operations.push(operation);
    }
  }
  const additional = pathItem[ADDITIONAL_OPERATIONS_KEY];
  if (isRecord(additional)) {
    for (const operation of Object.values(additional)) {
      if (isRecord(operation)) {
        operations.push(operation);
      }
    }
  }
  return operations;
};

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
  if (!isRecord(paths)) {
    return;
  }
  for (const pathItem of Object.values(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const operation of operationsOfPathItem(pathItem)) {
      fn(operation);
    }
  }
};
