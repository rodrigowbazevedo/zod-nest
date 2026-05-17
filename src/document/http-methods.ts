/**
 * Shared HTTP method list used to walk OpenAPI path items. Imported by
 * `collect-usage` (input-side ref scan) and `rewrite-refs` (response-side
 * Output suffix rewrite). Matches the OpenAPI 3.1 spec's operation methods.
 */
export const HTTP_METHODS: readonly string[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];
