import type { OpenAPIObject } from '@nestjs/swagger';

import { forEachOperation } from './http-methods.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/** Gate the Response Object `summary`, which only 3.2 permits: keep it when
 * emitting 3.2, strip it with a warning under 3.1 so the body stays conformant. */
export const applyResponseSummary = (doc: OpenAPIObject, opts: { emit: boolean }): void => {
  if (opts.emit) {
    return;
  }
  forEachOperation(doc, (operation, { path, method }) => {
    const responses = operation.responses;
    if (!isRecord(responses)) {
      return;
    }
    for (const [status, response] of Object.entries(responses)) {
      if (!isRecord(response) || response.summary === undefined) {
        continue;
      }
      delete response.summary;
      warnDropped(method, path, status);
    }
  });
};

const warnDropped = (method: string, path: string, status: string): void => {
  // eslint-disable-next-line no-console
  console.warn(
    `[zod-nest] Dropped \`summary\` from \`${method.toUpperCase()} ${path}\` response \`${status}\`: ` +
      'OpenAPI 3.1 has no Response Object `summary` field. ' +
      "Declare 3.2 via `DocumentBuilder.setOpenAPIVersion('3.2.0')` to emit it.",
  );
};
