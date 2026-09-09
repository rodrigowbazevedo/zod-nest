import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';

/** Media type describing a URL query string. The spec's own `in: querystring`
 * example uses it, and `content` is mandatory for that `in` value. */
export const QUERYSTRING_MEDIA_TYPE = 'application/x-www-form-urlencoded';

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export interface QuerystringParamParams {
  /** Component id the parameter references — also its `name`. */
  dtoId: string;
  /** Emitted schema body for the DTO, read only for its `required` array. */
  body: unknown;
}

/**
 * Build the OpenAPI 3.2 `in: 'querystring'` parameter: one Schema Object for
 * the whole query string, carried under `content` (3.2 forbids `schema` and
 * `style` on this `in` value).
 *
 * `required` follows the Zod schema — true when at least one field is
 * required, so the query string must be present. Per-field requiredness stays
 * in the referenced component's `required` array. `name` is kept because the
 * meta-schema requires it, though 3.2 does not use it in serialization.
 */
export const buildQuerystringParam = (params: QuerystringParamParams): Record<string, unknown> => {
  const { dtoId, body } = params;
  const required = isPlainRecord(body) && Array.isArray(body.required) && body.required.length > 0;
  return {
    name: dtoId,
    in: 'querystring',
    required,
    content: {
      [QUERYSTRING_MEDIA_TYPE]: {
        schema: { $ref: `${COMPONENTS_SCHEMAS_PREFIX}${dtoId}` },
      },
    },
  };
};

export interface QueryConflictParams {
  /** The operation's own parameter list, markers included. */
  parameters: readonly unknown[];
  /** The enclosing path item's parameter list, or `undefined` when it has none. */
  pathItemParameters: unknown;
  /** How many markers on this operation would collapse to a querystring. */
  candidateCount: number;
}

/**
 * Whether emitting `in: 'querystring'` on this operation would break 3.2's
 * coexistence rules: at most one per operation, and never alongside an
 * `in: 'query'` parameter in the operation or its path item.
 *
 * Markers are excluded from the `in: 'query'` scan — an unresolved marker is
 * not yet a query parameter, and the candidate count already accounts for it.
 */
export const hasQueryConflict = (params: QueryConflictParams): boolean => {
  const { parameters, pathItemParameters, candidateCount } = params;
  if (candidateCount > 1) {
    return true;
  }
  return containsQueryParam(parameters) || containsQueryParam(pathItemParameters);
};

/** Names of the `in: 'query'` parameters that block a querystring, for the warning. */
export const conflictingQueryNames = (
  parameters: readonly unknown[],
  pathItemParameters: unknown,
): string[] => [...queryNamesOf(parameters), ...queryNamesOf(pathItemParameters)];

const containsQueryParam = (parameters: unknown): boolean =>
  Array.isArray(parameters) && parameters.some(isPlainQueryParam);

const queryNamesOf = (parameters: unknown): string[] => {
  if (!Array.isArray(parameters)) {
    return [];
  }
  const names: string[] = [];
  for (const param of parameters) {
    if (!isPlainQueryParam(param)) {
      continue;
    }
    names.push(typeof param.name === 'string' ? param.name : '<unnamed>');
  }
  return names;
};

const isPlainQueryParam = (param: unknown): param is Record<string, unknown> =>
  isPlainRecord(param) && param.in === 'query' && param.__zodNestDto !== true;
