import type { OpenAPIObject } from '@nestjs/swagger';

import { isSequentialMediaType } from '../response/stream.js';
import { ZOD_NEST_ITEM_STREAM_EXTENSION } from '../schema/constants.js';
import { forEachOperation } from './http-methods.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/** Rewrite `schema` to 3.2's `itemSchema` wherever a body is a sequence of items:
 * the types 3.2 names sequential, plus anything marked `x-zod-nest-item-stream`.
 * Always runs — `emit: false` still strips that marker, which must never ship. */
export const applyItemSchema = (doc: OpenAPIObject, opts: { emit: boolean }): void => {
  forEachOperation(doc, (operation) => {
    visitContentHolder(operation.requestBody, opts.emit);
    const responses = operation.responses;
    if (!isRecord(responses)) {
      return;
    }
    for (const response of Object.values(responses)) {
      visitContentHolder(response, opts.emit);
    }
  });
};

const visitContentHolder = (holder: unknown, emit: boolean): void => {
  if (!isRecord(holder)) {
    return;
  }
  const content = holder.content;
  if (!isRecord(content)) {
    return;
  }
  for (const [mediaTypeKey, mediaType] of Object.entries(content)) {
    if (!isRecord(mediaType)) {
      continue;
    }
    rewriteMediaType(mediaTypeKey, mediaType, emit);
  }
};

const rewriteMediaType = (
  mediaTypeKey: string,
  mediaType: Record<string, unknown>,
  emit: boolean,
): void => {
  const marked = mediaType[ZOD_NEST_ITEM_STREAM_EXTENSION] === true;
  delete mediaType[ZOD_NEST_ITEM_STREAM_EXTENSION];
  if (!emit) {
    return;
  }
  if (!marked && !isSequentialMediaType(mediaTypeKey)) {
    return;
  }
  const itemSchema = itemSchemaOf(mediaType.schema);
  if (itemSchema === undefined) {
    return;
  }
  mediaType.itemSchema = itemSchema;
  delete mediaType.schema;
};

/** The item schema a body implies, or `undefined` to leave it alone. 3.2 reads
 * `schema` on a sequential type as the complete content-as-array, so a bounded
 * array or a tuple is already correct — only a bare array collapses. */
const itemSchemaOf = (schema: unknown): unknown => {
  if (!isRecord(schema)) {
    return undefined;
  }
  if (schema.type !== 'array') {
    return schema;
  }
  if (Object.keys(schema).length !== 2 || !('items' in schema)) {
    return undefined;
  }
  return isRecord(schema.items) ? schema.items : undefined;
};
