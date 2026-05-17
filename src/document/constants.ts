/**
 * Suffix appended to a dtoId when its input and output emissions diverge —
 * keeps the canonical id for the input body and lifts the output body to
 * `<id>Output`. Consumed by `merge-schemas` (split write) and `rewrite-refs`
 * (response-side ref rewriting).
 */
export const OUTPUT_SUFFIX = 'Output';
