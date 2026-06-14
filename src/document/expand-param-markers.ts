import type { OpenAPIObject } from '@nestjs/swagger';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';
import { ZodNestDocumentError } from './errors.js';
import { forEachOperation } from './http-methods.js';
import { walkRefs } from './walk-refs.js';

/**
 * How a named `@Query()` / `@ZodQuery` DTO is represented in the OpenAPI doc:
 *
 * - `'expand'` (default) — one parameter per top-level property of the DTO
 *   schema, each inlined or `$ref`'d independently.
 * - `'ref'` — a single schema-based query parameter that references the DTO's
 *   `components.schemas` entry (`style: 'form'`, `explode: true`,
 *   `schema: { $ref }`). The wire format is identical to `'expand'`; only the
 *   document representation collapses to the shared component.
 *
 * Query-only: path / header / cookie markers always expand regardless of this
 * setting, since the form-exploded-object pattern is a query serialization.
 */
export type QueryParamStyle = 'expand' | 'ref';

export interface ExpandParamMarkersParams {
  /** OpenAPI doc whose `paths.*.<op>.parameters[]` will be mutated in place. */
  doc: OpenAPIObject;
  /** Bulk-emitted input-side schemas keyed by `dtoId`. Source of truth for `io: 'input'` markers. */
  inputSchemas: ReadonlyMap<string, unknown>;
  /** Bulk-emitted output-side schemas keyed by `dtoId`. Source for the (rare) `io: 'output'` parameter marker. */
  outputSchemas: ReadonlyMap<string, unknown>;
  /**
   * Global preference for how `in: 'query'` DTO markers are represented.
   * Defaults to `'expand'`. A per-marker `ref` override (set by `@ZodQuery`)
   * wins over this when present.
   */
  queryParamStyle?: QueryParamStyle;
}

interface MarkerParam extends Record<string, unknown> {
  in: string;
  dtoId: string;
  io: 'input' | 'output';
  /**
   * Per-marker override of `queryParamStyle`. `true` forces the single-`$ref`
   * query parameter, `false` forces per-property expansion, `undefined` falls
   * back to the global preference. Only `@ZodQuery({ ref })` sets it; the
   * `@Query() dto` marker omits it (follows the global preference).
   */
  ref?: boolean;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Replaces every `@Query()` / `@Param()` / `@Headers()` / `@Cookie()` marker
 * parameter — the `__zodNestDto: true` placeholder produced by
 * `createZodDto`'s `_OPENAPI_METADATA_FACTORY` when the DTO class is bound to
 * a non-body decorator — with one parameter per top-level property of the
 * DTO schema.
 *
 * A `'query'` marker is instead collapsed to a single schema-based parameter
 * (`style: 'form'`, `explode: true`, `schema: { $ref }`) when ref mode applies
 * — either the per-marker `ref` override (from `@ZodQuery`) or the global
 * `queryParamStyle: 'ref'` preference. Ref mode is query-only; path / header /
 * cookie markers always expand. See `QueryParamStyle`.
 *
 * Runs after `mergeSchemas` (so the real schema body lives in the
 * `inputSchemas` map, and the DTO's component is in `doc.components.schemas`
 * for ref mode) and before `rewriteRefs` (so any `$ref` inside a property
 * schema gets rewritten in the subsequent pass).
 *
 * After expansion, if `components.schemas.Object` (the synthetic placeholder
 * `@nestjs/swagger` materialises from the marker's `type: () => Object`) has
 * no remaining referrers, the entry is pruned. This matches the cleaner
 * output the predecessor library (`nestjs-zod`) emitted and keeps the doc
 * free of dead schemas.
 *
 * Throws `ZodNestDocumentError('UNEXPANDABLE_PARAM_DTO')` when a marker
 * parameter resolves to a non-object schema (array, union, primitive, …) —
 * those shapes have no `properties` record to iterate, so the only sensible
 * action is to fail loudly at doc-build time.
 */
export const expandParamMarkers = (params: ExpandParamMarkersParams): void => {
  const { doc, inputSchemas, outputSchemas } = params;
  const queryParamStyle = params.queryParamStyle ?? 'expand';
  const schemas = doc.components?.schemas;
  const componentIds =
    schemas !== null && typeof schemas === 'object'
      ? new Set(Object.keys(schemas))
      : new Set<string>();
  let expandedAny = false;
  forEachOperation(doc, (op) => {
    const parameters = op.parameters;
    if (!Array.isArray(parameters)) {
      return;
    }
    const next = expandParameterList(parameters, {
      inputSchemas,
      outputSchemas,
      queryParamStyle,
      componentIds,
    });
    if (next !== parameters) {
      op.parameters = next;
      expandedAny = true;
    }
  });
  // The synthetic `components.schemas.Object` only appears when at least one
  // marker parameter was processed by @nestjs/swagger — skip the full-doc
  // ref walk on the common no-marker path.
  if (expandedAny) {
    pruneOrphanObjectSchema(doc);
  }
};

interface ExpandContext {
  readonly inputSchemas: ReadonlyMap<string, unknown>;
  readonly outputSchemas: ReadonlyMap<string, unknown>;
  readonly queryParamStyle: QueryParamStyle;
  readonly componentIds: ReadonlySet<string>;
}

const expandParameterList = (
  parameters: readonly unknown[],
  context: ExpandContext,
): readonly unknown[] => {
  let result: unknown[] | undefined;
  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i];
    const marker = readMarker(param);
    if (marker === undefined) {
      result?.push(param);
      continue;
    }
    if (result === undefined) {
      result = parameters.slice(0, i);
    }
    const map = marker.io === 'output' ? context.outputSchemas : context.inputSchemas;
    const body = map.get(marker.dtoId);
    result.push(...resolveMarker(marker, body, context));
  }
  return result ?? parameters;
};

/**
 * Decide whether a `'query'` marker collapses to a single schema-based
 * parameter (`ref`) or expands per-property. The per-marker `ref` override
 * wins; otherwise the global `queryParamStyle` decides. Ref mode is query-only
 * and needs the DTO's component to exist in the doc — `collectUsage` adds the
 * marker's dtoId to `inputExposedIds` so `mergeSchemas` emits it. If it somehow
 * still isn't present, fall back to expansion so the contract ships rather than
 * dangling.
 */
const resolveMarker = (marker: MarkerParam, body: unknown, context: ExpandContext): unknown[] => {
  const useRef = marker.ref ?? context.queryParamStyle === 'ref';
  if (marker.in === 'query' && useRef && context.componentIds.has(marker.dtoId)) {
    return [buildRefQueryParam(marker, body)];
  }
  return expandOne(marker, body);
};

/**
 * Build the single schema-based query parameter for `ref` mode. References the
 * DTO's `components.schemas` entry via `$ref`, with `style: 'form'` +
 * `explode: true` so the wire format matches the per-property expansion
 * (`?a=1&b=2`). The parameter is marked `required` when the schema has at
 * least one required field; per-field requiredness stays in the referenced
 * component's `required` array.
 */
const buildRefQueryParam = (marker: MarkerParam, body: unknown): Record<string, unknown> => {
  const required = isPlainRecord(body) && Array.isArray(body.required) && body.required.length > 0;
  return {
    name: marker.dtoId,
    in: 'query',
    required,
    style: 'form',
    explode: true,
    schema: { $ref: `${COMPONENTS_SCHEMAS_PREFIX}${marker.dtoId}` },
  };
};

const readMarker = (value: unknown): MarkerParam | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  if (value.__zodNestDto !== true) {
    return undefined;
  }
  if (typeof value.dtoId !== 'string' || value.dtoId === '') {
    return undefined;
  }
  if (value.io !== 'input' && value.io !== 'output') {
    return undefined;
  }
  if (typeof value.in !== 'string' || value.in === '') {
    return undefined;
  }
  if (value.ref !== undefined && typeof value.ref !== 'boolean') {
    return undefined;
  }
  return value as MarkerParam;
};

const expandOne = (marker: MarkerParam, body: unknown): unknown[] => {
  if (!isPlainRecord(body) || !isPlainRecord(body.properties)) {
    throw new ZodNestDocumentError(
      'UNEXPANDABLE_PARAM_DTO',
      `Cannot expand \`@${capitalize(marker.in)}() x: ${marker.dtoId}\` — the DTO's schema is not an object with \`properties\`. ` +
        `Non-body parameter DTOs must be object schemas; arrays, unions, primitives, etc. cannot be split into individual ` +
        `parameters. Use \`@Body()\` for non-object DTOs, or restructure the schema as an object whose fields become the params.`,
      { dtoId: marker.dtoId, in: marker.in, io: marker.io },
    );
  }
  const properties = body.properties;
  const requiredSet = collectRequired(body.required);
  const out: unknown[] = [];
  for (const [propName, propSchemaRaw] of Object.entries(properties)) {
    if (!isPlainRecord(propSchemaRaw)) {
      continue;
    }
    out.push(buildParameter(marker, propName, propSchemaRaw, requiredSet.has(propName)));
  }
  return out;
};

const collectRequired = (value: unknown): Set<string> => {
  if (!Array.isArray(value)) {
    return new Set();
  }
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string') {
      out.add(item);
    }
  }
  return out;
};

const buildParameter = (
  marker: MarkerParam,
  name: string,
  schema: Record<string, unknown>,
  required: boolean,
): Record<string, unknown> => {
  let effectiveRequired = required;
  if (marker.in === 'path' && !effectiveRequired) {
    // eslint-disable-next-line no-console
    console.warn(
      `[zod-nest] Path parameter \`${name}\` on DTO \`${marker.dtoId}\` is marked optional ` +
        `in the Zod schema; OpenAPI 3.1 requires path parameters to be required. ` +
        `Coercing \`required: true\` so the emitted document is spec-valid. ` +
        `Fix by removing \`.optional()\` / \`.nullish()\` from the field, or by switching ` +
        `the decorator to @Query() / @Headers() if the field is genuinely optional.`,
    );
    effectiveRequired = true;
  }
  return {
    name,
    in: marker.in,
    required: effectiveRequired,
    schema,
  };
};

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const pruneOrphanObjectSchema = (doc: OpenAPIObject): void => {
  const schemas = doc.components?.schemas as Record<string, unknown> | undefined;
  if (schemas === undefined || !Object.prototype.hasOwnProperty.call(schemas, 'Object')) {
    return;
  }
  let referenced = false;
  const targetRef = `${COMPONENTS_SCHEMAS_PREFIX}Object`;
  walkRefs(doc, (ref) => {
    if (ref === targetRef) {
      referenced = true;
    }
    return undefined;
  });
  if (!referenced) {
    delete schemas.Object;
  }
};
