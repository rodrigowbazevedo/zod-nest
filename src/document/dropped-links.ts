import type { OpenAPIObject } from '@nestjs/swagger';

import { ZOD_NEST_LINKS_EXTENSION } from '../schema/constants.js';
import { forEachOperation } from './http-methods.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

// @nestjs/swagger 12.1+ silently drops links whose operationId no operation carries.
export const reportDroppedLinks = (doc: OpenAPIObject): void => {
  forEachOperation(doc, (operation, { path, method }) => {
    const responses = operation.responses;
    if (!isRecord(responses)) {
      return;
    }
    for (const [status, response] of Object.entries(responses)) {
      if (!isRecord(response) || !(ZOD_NEST_LINKS_EXTENSION in response)) {
        continue;
      }
      const declared = response[ZOD_NEST_LINKS_EXTENSION];
      delete response[ZOD_NEST_LINKS_EXTENSION];
      if (!isRecord(declared)) {
        continue;
      }
      const surviving = isRecord(response.links) ? response.links : {};
      for (const [name, operationId] of Object.entries(declared)) {
        if (!(name in surviving)) {
          warnDropped({ name, operationId: String(operationId), method, path, status });
        }
      }
    }
  });
};

interface DroppedLink {
  name: string;
  operationId: string;
  method: string;
  path: string;
  status: string;
}

const warnDropped = ({ name, operationId, method, path, status }: DroppedLink): void => {
  // eslint-disable-next-line no-console
  console.warn(
    `[zod-nest] @nestjs/swagger dropped link \`${name}\` from \`${method.toUpperCase()} ${path}\` ` +
      `response \`${status}\`: no operation in this document has operationId \`${operationId}\`. ` +
      'Set it on the target route with `@ApiOperation({ operationId })`; ' +
      'ignore this if the target is excluded from this document on purpose.',
  );
};
