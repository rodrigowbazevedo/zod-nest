import type { OpenAPIObject } from '@nestjs/swagger';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';
import { ZodNestDocumentError } from './errors.js';
import { operationEntriesOfPathItem } from './http-methods.js';
import {
  buildQuerystringParam,
  conflictingQueryNames,
  hasQueryConflict,
} from './querystring-param.js';
import { walkRefs } from './walk-refs.js';

/**
 * How a named `@Query()` / `@ZodQuery` DTO is represented in the OpenAPI doc:
 *
 * - `'expand'` — one parameter per top-level property of the DTO schema.
 * - `'ref'` — collapse to a single parameter carrying the whole schema.
 *
 * Query-only: path / header / cookie markers always expand, since collapsing
 * an object into one parameter is a query serialization.
 *
 * @deprecated Removed in the next major. 3.2 collapses named query DTOs to
 * `in: 'querystring'` by default, which is what this option approximated.
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
   * Explicit override of the version-derived default. Unset is meaningful —
   * it is what lets 3.2 collapse and 3.1 expand.
   *
   * @deprecated See {@link QueryParamStyle}.
   */
  queryParamStyle?: QueryParamStyle;
  /** Target is OpenAPI 3.2: collapse by default, and render as `in: 'querystring'`. */
  emitThirtyTwo?: boolean;
}

interface MarkerParam extends Record<string, unknown> {
  in: string;
  dtoId: string;
  io: 'input' | 'output';
  /**
   * Per-marker override: `true` collapses, `false` expands, `undefined` defers
   * to `queryParamStyle` and then to the target version. Only `@ZodQuery({ ref })`
   * sets it — `@Query() dto` omits it.
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
 * A `'query'` marker with a named component instead collapses to one
 * parameter carrying the whole schema: `in: 'querystring'` + `content` under
 * 3.2, or the 3.1 approximation of it (`in: 'query'`, `style: 'form'`,
 * `explode: true`). `@ZodQuery({ ref })` wins, then `queryParamStyle`, then
 * the target version. Query-only; path / header / cookie markers always expand.
 *
 * Collapsing degrades to expansion — never an error — when the component is
 * missing, or when 3.2's coexistence rules would be broken (a sibling
 * `in: 'query'` parameter on the operation or its path item, or more than one
 * candidate). The last two warn.
 *
 * Runs after `mergeSchemas` (so the real schema body lives in the
 * `inputSchemas` map, and the DTO's component is in `doc.components.schemas`
 * to collapse against) and before `rewriteRefs` (so any `$ref` inside a
 * property schema gets rewritten in the subsequent pass).
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
  const { doc, inputSchemas, outputSchemas, queryParamStyle } = params;
  const emitThirtyTwo = params.emitThirtyTwo ?? false;
  const schemas = doc.components?.schemas;
  const componentIds =
    schemas !== null && typeof schemas === 'object'
      ? new Set(Object.keys(schemas))
      : new Set<string>();
  if (queryParamStyle !== undefined && emitThirtyTwo) {
    warnDeprecatedQueryParamStyle();
  }
  const context: ExpandContext = {
    inputSchemas,
    outputSchemas,
    queryParamStyle,
    emitThirtyTwo,
    componentIds,
  };
  let expandedAny = false;
  // Walks `doc.paths` directly rather than via `forEachOperation`, which
  // exposes no path item — 3.2's coexistence rule spans its `parameters` too.
  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!isPlainRecord(pathItem)) {
      continue;
    }
    for (const { method, operation } of operationEntriesOfPathItem(pathItem)) {
      const parameters = operation.parameters;
      if (!Array.isArray(parameters)) {
        continue;
      }
      const next = expandParameterList(parameters, context, {
        path,
        method,
        pathItemParameters: pathItem.parameters,
      });
      if (next !== parameters) {
        operation.parameters = next;
        expandedAny = true;
      }
    }
  }
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
  readonly queryParamStyle: QueryParamStyle | undefined;
  readonly emitThirtyTwo: boolean;
  readonly componentIds: ReadonlySet<string>;
}

/** Where the parameter list being expanded lives, for conflict checks and warnings. */
interface OperationScope {
  readonly path: string;
  readonly method: string;
  readonly pathItemParameters: unknown;
}

const expandParameterList = (
  parameters: readonly unknown[],
  context: ExpandContext,
  scope: OperationScope,
): readonly unknown[] => {
  const candidateCount = countCollapseCandidates(parameters, context);
  const collapseBlocked =
    context.emitThirtyTwo &&
    candidateCount > 0 &&
    hasQueryConflict({
      parameters,
      pathItemParameters: scope.pathItemParameters,
      candidateCount,
    });
  if (collapseBlocked) {
    warnQuerystringDegraded(scope, parameters, candidateCount);
  }
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
    result.push(...resolveMarker(marker, body, context, collapseBlocked));
  }
  return result ?? parameters;
};

/**
 * Whether this marker collapses at all. Needs the DTO's component to exist —
 * `collectUsage` seeds it into `inputExposedIds` so `mergeSchemas` emits it, but
 * if it somehow isn't there, expansion ships a contract rather than a dangling ref.
 */
const wouldCollapse = (marker: MarkerParam, context: ExpandContext): boolean =>
  marker.in === 'query' &&
  prefersCollapse(marker, context) &&
  context.componentIds.has(marker.dtoId);

/** First match wins: the per-marker flag, then the global option, then the version. */
const prefersCollapse = (marker: MarkerParam, context: ExpandContext): boolean => {
  if (marker.ref !== undefined) {
    return marker.ref;
  }
  if (context.queryParamStyle !== undefined) {
    return context.queryParamStyle === 'ref';
  }
  return context.emitThirtyTwo;
};

const countCollapseCandidates = (
  parameters: readonly unknown[],
  context: ExpandContext,
): number => {
  let count = 0;
  for (const param of parameters) {
    const marker = readMarker(param);
    if (marker !== undefined && wouldCollapse(marker, context)) {
      count += 1;
    }
  }
  return count;
};

/** Collapse to one parameter, or expand per-property. 3.2 renders a collapse as
 * `in: 'querystring'`; 3.1 as the `style: 'form'` approximation of it. */
const resolveMarker = (
  marker: MarkerParam,
  body: unknown,
  context: ExpandContext,
  collapseBlocked: boolean,
): unknown[] => {
  if (marker.ref !== undefined && context.emitThirtyTwo) {
    warnDeprecatedRefOption(marker.dtoId);
  }
  if (collapseBlocked || !wouldCollapse(marker, context)) {
    return expandOne(marker, body);
  }
  if (context.emitThirtyTwo) {
    return [buildQuerystringParam({ dtoId: marker.dtoId, body })];
  }
  return [buildRefQueryParam(marker, body)];
};

/**
 * The 3.1 approximation of `in: 'querystring'`: `style: 'form'` + `explode: true`
 * so the wire format still reads `?a=1&b=2`. `required` follows the Zod schema —
 * true when at least one field is required.
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

const warnQuerystringDegraded = (
  scope: OperationScope,
  parameters: readonly unknown[],
  candidateCount: number,
): void => {
  // eslint-disable-next-line no-console
  console.warn(
    `[zod-nest] Expanded the query DTO on \`${scope.method.toUpperCase()} ${scope.path}\` ` +
      `per-property instead of emitting \`in: 'querystring'\`: ` +
      `${degradeReason(scope, parameters, candidateCount)} ` +
      'The expanded form is spec-valid, so the document still ships.',
  );
};

const degradeReason = (
  scope: OperationScope,
  parameters: readonly unknown[],
  candidateCount: number,
): string => {
  if (candidateCount > 1) {
    return `OpenAPI 3.2 allows at most one \`querystring\` parameter per operation, and this one has ${candidateCount} query DTOs.`;
  }
  const names = conflictingQueryNames(parameters, scope.pathItemParameters);
  return (
    "OpenAPI 3.2 forbids a `querystring` parameter alongside `in: 'query'` parameters " +
    `(${names.map((name) => `\`${name}\``).join(', ')}).`
  );
};

const warnDeprecatedQueryParamStyle = (): void => {
  // eslint-disable-next-line no-console
  console.warn(
    '[zod-nest] `queryParamStyle` is deprecated and will be removed in the next major: ' +
      "OpenAPI 3.2 emits `in: 'querystring'` for named query DTOs by default, which is what " +
      'this option approximated. Drop it to take the default.',
  );
};

const warnDeprecatedRefOption = (dtoId: string): void => {
  // eslint-disable-next-line no-console
  console.warn(
    `[zod-nest] \`@ZodQuery({ ref })\` on \`${dtoId}\` is deprecated and will be removed in ` +
      "the next major: OpenAPI 3.2 emits `in: 'querystring'` for named query DTOs by default. " +
      'Drop the option to take the default.',
  );
};

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
