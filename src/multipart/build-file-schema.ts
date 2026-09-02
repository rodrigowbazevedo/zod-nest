import { z } from 'zod';

import type { SchemaObject } from '../schema/openapi.types.js';
import type { FileAccessors, FileCheck } from './file-checks.js';

import { binary } from '../helpers/fragments.js';
import { overrideJSONSchema } from '../schema/custom-override.js';
import { extensionCheck, mimeTypeCheck, sizeCheck } from './file-checks.js';
import { markFileSchema } from './file-marker.js';

export interface BaseFileOptions {
  /**
   * Registry id for the schema. Set it to get a reusable
   * `components.schemas` entry that every field `$ref`s, instead of the
   * fragment being inlined at each use site. There is no `title` counterpart
   * — `overrideJSONSchema` replaces the emitted body and does not carry
   * `title` into it, so one would have no effect.
   */
  readonly id?: string;
  /** Allowed MIME types, matched case-insensitively against the client-supplied value. */
  readonly mimeTypes?: readonly string[];
  /** Allowed filename extensions, with or without a leading dot. */
  readonly extensions?: readonly string[];
  /** OpenAPI `description` for the emitted binary property. */
  readonly description?: string;
  /** Overrides the `contentMediaType` derived from a single-entry `mimeTypes`. */
  readonly contentMediaType?: string;
}

export interface BuildFileSchemaParams<TFile> {
  readonly predicate: (value: unknown) => boolean;
  readonly accessors: FileAccessors<TFile>;
  readonly options: BaseFileOptions | undefined;
  /** Byte-size ceiling. Only platforms that report a size pass this. */
  readonly maxSize?: number;
}

const resolveFragment = (options: BaseFileOptions | undefined): SchemaObject => {
  const contentMediaType = options?.contentMediaType ?? singleMimeType(options?.mimeTypes);
  return binary({
    ...(options?.description !== undefined ? { description: options.description } : {}),
    ...(contentMediaType !== undefined ? { contentMediaType } : {}),
  });
};

const singleMimeType = (mimeTypes: readonly string[] | undefined): string | undefined => {
  if (mimeTypes === undefined || mimeTypes.length !== 1) {
    return undefined;
  }
  return mimeTypes[0];
};

const collectChecks = <TFile>(params: BuildFileSchemaParams<TFile>): Array<FileCheck<TFile>> => {
  const { accessors, options, maxSize } = params;
  const checks: Array<FileCheck<TFile>> = [];
  if (options?.mimeTypes !== undefined) {
    checks.push(mimeTypeCheck(accessors, { mimeTypes: options.mimeTypes }));
  }
  if (options?.extensions !== undefined) {
    checks.push(extensionCheck(accessors, { extensions: options.extensions }));
  }
  if (maxSize !== undefined && accessors.size !== undefined) {
    checks.push(sizeCheck(accessors.size, { maxSize }));
  }
  return checks;
};

const withId = <TFile>(
  schema: z.ZodType<TFile, TFile>,
  options: BaseFileOptions | undefined,
  fragment: SchemaObject,
): z.ZodType<TFile, TFile> => {
  if (options?.id === undefined) {
    return schema;
  }
  return overrideJSONSchema(schema.meta({ id: options.id }), fragment);
};

/**
 * Assemble a platform file schema: duck-typing predicate, the option checks,
 * then `.meta({ id })` — re-registering the binary fragment after every step.
 *
 * Each registration is load-bearing. `overrideJSONSchema` keys its fragment on
 * the schema *instance*, and both `.check()` and `.meta()` clone. Emission
 * visits every instance in the chain, so a step left unregistered emits `{}`
 * — as a bare `{}` property in strict mode, or as an empty `components.schemas`
 * entry when the schema is named.
 */
export const buildFileSchema = <TFile>(
  params: BuildFileSchemaParams<TFile>,
): z.ZodType<TFile, TFile> => {
  const fragment = resolveFragment(params.options);
  const base = overrideJSONSchema(z.custom<TFile>(params.predicate), fragment);
  const checks = collectChecks(params);
  const checked = checks.length === 0 ? base : overrideJSONSchema(base.check(...checks), fragment);
  return markFileSchema(withId(checked, params.options, fragment));
};
