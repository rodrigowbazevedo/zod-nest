import type { OpenAPIObject } from '@nestjs/swagger';

import { COMPONENTS_SCHEMAS_PREFIX } from '../schema/constants.js';

/**
 * Copies each named component's `title` onto every `$ref` that targets it, as a
 * sibling property: `{ $ref: '#/components/schemas/Foo', title: 'Foo' }`.
 *
 * OpenAPI 3.1 (unlike 3.0) permits sibling keywords next to `$ref`. Swagger
 * UI's 3.1 renderer inlines referenced schemas without surfacing their
 * component name (swagger-api/swagger-ui#9540); carrying the target's `title`
 * onto the reference gives the renderer — and other 3.1-aware tooling — a name
 * to display for the reference.
 *
 * Only components that actually declare a `title` (via `.meta({ title })`)
 * contribute one; refs to untitled components are left untouched, and a `$ref`
 * that already carries its own `title` is never overwritten. The annotation is
 * semantically inert (a `title` is an annotation keyword, no validation
 * effect).
 *
 * Runs last — after every ref has been rewritten to its final dtoId and
 * anonymous bodies have been inlined — so titles also land on the member refs
 * inside an inlined anonymous body.
 */
export const applyRefTitles = (doc: OpenAPIObject): void => {
  const schemas = doc.components?.schemas;
  if (schemas === undefined) {
    return;
  }
  const titleById = new Map<string, string>();
  for (const [id, body] of Object.entries(schemas)) {
    if (isPlainRecord(body) && typeof body.title === 'string' && body.title !== '') {
      titleById.set(id, body.title);
    }
  }
  if (titleById.size === 0) {
    return;
  }
  addRefTitles(doc.paths, titleById);
  addRefTitles(schemas, titleById);
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const addRefTitles = (node: unknown, titleById: ReadonlyMap<string, string>): void => {
  if (Array.isArray(node)) {
    for (const item of node) {
      addRefTitles(item, titleById);
    }
    return;
  }
  if (!isPlainRecord(node)) {
    return;
  }
  const ref = node.$ref;
  if (
    typeof ref === 'string' &&
    ref.startsWith(COMPONENTS_SCHEMAS_PREFIX) &&
    node.title === undefined
  ) {
    const title = titleById.get(ref.slice(COMPONENTS_SCHEMAS_PREFIX.length));
    if (title !== undefined) {
      node.title = title;
    }
  }
  for (const value of Object.values(node)) {
    addRefTitles(value, titleById);
  }
};
