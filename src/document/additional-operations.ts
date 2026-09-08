import type { OpenAPIObject } from '@nestjs/swagger';

import { ADDITIONAL_OPERATIONS_KEY, EXTENSION_OPERATION_KEYS } from './http-methods.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/** Move `search` / WebDAV operations into `additionalOperations`, the only place
 * OpenAPI 3.2 takes them. 3.1 has none, so call this for 3.2 targets only. */
export const relocateExtensionOperations = (doc: OpenAPIObject): void => {
  const paths = doc.paths;
  if (!isRecord(paths)) {
    return;
  }
  for (const pathItem of Object.values(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    relocateInPathItem(pathItem);
  }
};

const relocateInPathItem = (pathItem: Record<string, unknown>): void => {
  const relocated: Record<string, unknown> = {};
  for (const method of EXTENSION_OPERATION_KEYS) {
    const operation = pathItem[method];
    if (!isRecord(operation)) {
      continue;
    }
    relocated[method.toUpperCase()] = operation;
    delete pathItem[method];
  }
  if (Object.keys(relocated).length === 0) {
    return;
  }
  const existing = pathItem[ADDITIONAL_OPERATIONS_KEY];
  // Caller-authored entries win — we are adding to their map, not owning it.
  pathItem[ADDITIONAL_OPERATIONS_KEY] = isRecord(existing)
    ? { ...relocated, ...existing }
    : relocated;
};
