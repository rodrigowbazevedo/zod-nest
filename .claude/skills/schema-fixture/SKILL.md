---
name: schema-fixture
description: >
  Add a parameterized Zod → OpenAPI test case to the zod-nest engine spec suite (`test/schema/engine.*.spec.ts`). Use whenever the user wants to lock in a new emission behaviour with a test, regression-cover a bug fix in the schema engine, drop a fixture suggested by `/scan-zod-features`, or write a snippet that demonstrates an interesting emission. Auto-selects the right spec file from the schema shape (primitive vs modifier vs composite vs recursion vs named-ref vs registry vs i/o-divergence vs override vs strict vs snapshot) but accepts an override. Generates a single new `it()` block in the project's existing style — never restructures the file or invents a new pattern.
---

# schema-fixture

Adds one new test case to the engine spec suite. Designed for the common path: a Zod construct + an expected JSON Schema fragment → a `it('case name', () => { ... })` block dropped into the right spec file.

## When to invoke

- **A new emission behaviour needs locking in** — e.g. a Zod release added a representation, or an override turned an unrepresentable type into a representable one.
- **A bug fix needs regression coverage** — minimal reproducer of the wrong-emission case before the fix.
- **`/scan-zod-features` flagged a behaviour worth pinning** — the orchestrator hands off the case description; this skill writes the spec block.
- **An interesting emission deserves documentation** — sometimes the cleanest place to demonstrate a schema's emission is the test, especially for snapshot-driven composites.

## Inputs

Required:

- **Case name** — the title for the `it()` block. Should describe the invariant, not the procedure (`'optional + default emits required: false and a JSON Schema default'`, not `'test optional with default'`).
- **Zod snippet** — the schema construction. A single expression (`z.string().optional()`) or a small `const`-bound block.
- **Expected** — one of:
  - A JSON Schema fragment (object) to assert via `.toEqual(...)`.
  - The literal string `snapshot` to use Jest snapshot matching (drops into `engine.snapshot.spec.ts`).
  - A `Promise.rejects.toThrow(<ErrorCtor>)`-shaped expectation for unrepresentable cases (`engine.strict.spec.ts`).

Optional:

- **Target spec** — override the auto-selection. Useful when the case spans multiple categories.
- **`io`** — `'input'` or `'output'`. Defaults to `'output'`. For divergence cases, two `it()` blocks (one per side).

## Workflow

### Step 1: Auto-select the target spec

If the user didn't pass an explicit target, infer from the schema shape using [`references/engine-specs.md`](references/engine-specs.md). The reference doc lists every `engine.*.spec.ts` and the shape signature that maps to it.

The auto-selection is best-effort. If the schema spans categories (e.g. an `z.object()` with `.optional()` fields and a `.transform()`), surface a one-line decision: _"This case has both modifier and io-divergence signals — placing it in `engine.io-divergence.spec.ts` because the divergence is the load-bearing behaviour. Pass an explicit target to override."_

### Step 2: Verify the case isn't already covered

Grep the candidate spec file (and adjacent specs for cross-category cases) for similar Zod constructs. A near-duplicate is a sign the new case should either:

- Replace the existing one with a better-named version (rare — surface this for user decision).
- Be merged into the existing case as an additional assertion (sometimes appropriate).
- Skip — the coverage is already there.

When in doubt, add the new case. Duplication is easier to clean up than missing coverage.

### Step 3: Compose the `it()` block

Follow the project style observed across `test/schema/engine.*.spec.ts`:

- Import `z` and the needed helpers from `'../../src'`.
- Use the file's existing `registry` constant (each spec defines `const registry = createRegistry()` at the top of its `describe`).
- `it()` title is the **case name** passed in — verbatim if possible.
- The assertion shape matches the spec's convention:
  - Most specs use `expect(toOpenApi(<schema>, { io, registry }).schema).toEqual(<expected>)`.
  - `engine.snapshot.spec.ts` uses `.toMatchSnapshot('<key>')`.
  - `engine.strict.spec.ts` uses `expect(() => toOpenApi(...)).toThrow(ZodNestUnrepresentableError)` (the synchronous form — `toOpenApi` doesn't return a Promise).

Insert the block at the end of the file's main `describe`, just before the closing `});`. Don't reorder existing cases.

### Step 4: Verify the spec passes

Run the targeted spec:

```bash
npx jest --testPathPattern="engine\\.<spec>" --no-coverage
```

If the assertion fails, the case is mis-specified — surface the actual emission and ask the user whether the expected should be updated (the spec is the ground truth) or whether the Zod snippet should change.

Snapshot cases: if running for the first time, jest writes the snapshot. Confirm with the user that the captured output is correct before considering the task done.

### Step 5: Confirm with a one-line summary

After the spec passes, output a single confirmation:

```
✅ Added `<case name>` to `test/schema/engine.<spec>.spec.ts:<line>`. Spec passes.
```

If the case was skipped (Step 2 found duplicate coverage):

```
↩️ Skipped — `engine.<spec>.spec.ts:<line>` already covers `<existing case name>`. New case would be redundant.
```

## Out of scope

- **Engine source changes.** This skill only writes tests. Fixing the engine to make a failing test pass is a separate task.
- **Test-helper refactors.** If the test suite has a shared helper that doesn't fit the new case, surface the gap — don't invent a new helper inline.
- **Cross-file refactoring.** Each invocation touches exactly one spec file. Splitting a spec or moving cases between files is a separate task.

## Notes

- Project style favors one-`it()`-per-case over `it.each` parameterization. Don't introduce `it.each` here unless the existing spec already uses it.
- The convention is `io: 'output'` unless the case is about input-specific shape or i/o divergence.
- Schema ids in fixtures are prefixed by area (`Snapshot_`, `Comp_`, `Output_`, `Reg_`, etc.) to keep the test-time registry traceable across cross-file pollution.
