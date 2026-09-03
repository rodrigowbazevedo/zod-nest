import { z } from 'zod';

import { findIdOwner } from './clone-chain.js';
import { discoverDependents } from './discover-dependents.js';
import { singleton } from './singleton.js';

/**
 * Per-registration flags carried alongside the id.
 *
 * - `expose` — force the id into the emitted document even when no endpoint
 *   references it. The author deliberately wants it in `components.schemas`
 *   (e.g. for out-of-band client codegen). Default exposure is otherwise
 *   reachability-scoped, so an unreferenced schema is pruned unless flagged.
 * - `anonymous` — the id is a synthetic placeholder for a schema with no
 *   resolvable id (passed inline to `@ZodResponse` / `@ZodBody`). It exists
 *   only to carry the body through bulk emission under the document's
 *   `strict` / `override` options; `inlineAnonymousBodies` later inlines the
 *   body at each `$ref` site and prunes the component, so the synthetic id
 *   never reaches the final document.
 *
 * Both flags are sticky — once set for an id they stay set, so a later plain
 * `register` of the same id (e.g. the idempotent re-register inside
 * `createZodDto`) doesn't clear them.
 */
export interface RegisterFlags {
  readonly expose?: boolean;
  readonly anonymous?: boolean;
}

export interface ZodNestRegistry {
  readonly zodRegistry: typeof z.globalRegistry;
  register(schema: z.ZodType, id: string, flags?: RegisterFlags): void;
  hasCollision(id: string): boolean;
  getCollisions(): ReadonlyMap<string, ReadonlySet<z.ZodType>>;
  /**
   * Snapshot of every id registered through this `ZodNestRegistry`. The
   * underlying Zod registry is `z.globalRegistry`, which may hold third-party
   * entries — bulk emission scopes both its input registry and its output to
   * this snapshot, so third-party entries are neither emitted nor
   * strict-checked.
   *
   * Includes ids discovered transitively via `.meta({ id })` on descendants
   * of explicitly-registered schemas.
   */
  ids(): readonly string[];
  /** Ids registered with `{ expose: true }` — exposed regardless of usage. */
  forceExposedIds(): readonly string[];
  /** Ids registered with `{ anonymous: true }` — inlined + pruned by `applyZodNest`. */
  anonymousIds(): readonly string[];
}

export const createRegistry = (): ZodNestRegistry => {
  const seen = new Map<string, Set<z.ZodType>>();
  const forceExposed = new Set<string>();
  const anonymous = new Set<string>();
  const pendingRoots: z.ZodType[] = [];

  const recordOnce = (schema: z.ZodType, id: string): boolean => {
    let set = seen.get(id);
    if (set === undefined) {
      set = new Set<z.ZodType>();
      seen.set(id, set);
    }
    if (set.has(schema)) {
      return false;
    }
    set.add(schema);
    return true;
  };

  const flushPendingDiscovery = (): void => {
    for (const root of pendingRoots.splice(0)) {
      for (const [child, childId] of discoverDependents(root)) {
        recordOnce(child, childId);
      }
    }
  };

  return {
    zodRegistry: z.globalRegistry,
    register: (schema, id, flags) => {
      // Flags are sticky: a later plain re-register of the same id (e.g. the
      // idempotent call inside `createZodDto`) must not clear an earlier
      // `expose` / `anonymous`.
      if (flags?.expose === true) {
        forceExposed.add(id);
      }
      if (flags?.anonymous === true) {
        anonymous.add(id);
      }
      // `globalRegistry.add` overwrites the schema's entire meta entry; we
      // must merge so user-supplied fields (`title`, `description`,
      // anything else in `.meta({...})`) survive registration. The `has`
      // gate avoids promoting parent-inherited meta into a local entry
      // — `get()` returns parent-merged metadata when the schema has no
      // local entry, and writing that back here would freeze the
      // inherited fields against the schema.
      if (z.globalRegistry.has(schema)) {
        // `?? {}` is unreachable — the `has` gate guarantees a local entry —
        // but the return type is optional, so the fallback satisfies it.
        const existing = z.globalRegistry.get(schema) ?? {};
        if (existing.id !== id) {
          z.globalRegistry.add(schema, { ...existing, id });
        }
      } else {
        z.globalRegistry.add(schema, { id });
      }
      if (!recordOnce(schema, id)) {
        return;
      }
      // Queue, don't walk: forcing `z.lazy` getters here reads forward
      // references still in their temporal dead zone (throws under ESM,
      // yields `undefined` under CJS). Draining on first read is always safe.
      pendingRoots.push(schema);
    },
    hasCollision: (id) => {
      flushPendingDiscovery();
      const set = seen.get(id);
      return set !== undefined && set.size > 1;
    },
    getCollisions: () => {
      flushPendingDiscovery();
      const out = new Map<string, Set<z.ZodType>>();
      for (const [id, set] of seen) {
        if (set.size <= 1) {
          continue;
        }
        out.set(id, set);
      }
      return out;
    },
    ids: () => {
      flushPendingDiscovery();
      return [...seen.keys()];
    },
    forceExposedIds: () => [...forceExposed],
    anonymousIds: () => [...anonymous],
  };
};

/** Process-wide default registry. Shared so subpath ids reach `applyZodNest`. */
export const defaultRegistry: ZodNestRegistry = singleton('default-registry', createRegistry);

export interface RegisterSchemaOptions {
  /** Forces this id, overriding any `.meta({ id })` already on the schema. */
  readonly id?: string;
  /**
   * Force the schema into the emitted document even when no endpoint
   * references it. Default exposure is reachability-scoped — see
   * {@link RegisterFlags.expose}.
   */
  readonly expose?: boolean;
  /**
   * Mark the resolved id as a synthetic anonymous placeholder — inlined and
   * pruned by `applyZodNest`. See {@link RegisterFlags.anonymous}.
   */
  readonly anonymous?: boolean;
}

/**
 * Register a schema with the given registry, resolving its id from (in order):
 * an explicit `options.id`, then `.meta({ id })` on the schema. Returns the
 * resolved id, or `undefined` when neither source yields one (the call is then
 * a no-op — callers with their own fallback path handle that case).
 *
 * Shared by `createZodDto` and `extend` so a schema named via `.meta({ id })`
 * gets its body emitted into `components.schemas` even when it never flows
 * through `createZodDto` (e.g. used only as an `extend()` parent — Zod's
 * `.extend()` produces a flat object, so the parent isn't a transitive
 * descendant of the child and would otherwise be missed by `discoverDependents`).
 *
 * Idempotent — `registry.register` already deduplicates repeat calls.
 */
export const registerSchema = (
  schema: z.ZodType,
  registry: ZodNestRegistry = defaultRegistry,
  options?: RegisterSchemaOptions,
): string | undefined => {
  const flags: RegisterFlags = { expose: options?.expose, anonymous: options?.anonymous };
  const explicit = options?.id;
  if (typeof explicit === 'string' && explicit !== '') {
    registry.register(schema, explicit, flags);
    return explicit;
  }
  // Registers the *owner*, never the clone: two instances under one id read as
  // a collision (`recordOnce`), and the clone already emits `$ref` to the owner.
  const named = findIdOwner(schema, registry.zodRegistry);
  if (named === undefined) {
    return undefined;
  }
  registry.register(named.owner, named.id, flags);
  return named.id;
};
