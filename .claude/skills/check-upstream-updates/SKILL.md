---
name: check-upstream-updates
description: >
  Audit upstream npm packages that zod-nest depends on (zod, @nestjs/swagger, @nestjs/common + @nestjs/core, rxjs) and produce a triage with ✅ safe bumps / ⚠️ needs investigation / 💡 opportunities / 🚫 blocked. Use whenever the user wants to check for upstream updates, mentions "are we behind on zod / nestjs", asks about compatibility risk, prepares for a release, or notices a downstream consumer report a peer-dep warning. Single orchestrator skill — delegates to `/scan-zod-features` and `/scan-nest-features` for source-aware deep dives when those targets are involved; falls back to changelog scrape for rxjs and anything else. Creates one GitHub issue per actionable finding (⚠️ / 🚫, optionally 💡) labelled `upstream-update`, and emits an inline summary of what was created and skipped.
---

# check-upstream-updates

Periodic upstream-dependency audit for zod-nest. Cadence is **manual** — invoke when prepping a release, when a downstream user reports a peer-dep warning, or when you suspect we're materially behind on something. There's no scheduled automation.

## When to invoke

- **Before cutting a release.** Pull in safe patches; surface blockers before they bite consumers.
- **When `npm install` warns about peer-dep mismatches** in a downstream project — gives a concrete sense of how stale our floor is.
- **After a major upstream release** (Zod x.y.0, Nest x.0.0). The dedicated scanners surface code-level impact.
- **As a quarterly hygiene check** — even when nothing's broken, drift accumulates.

## Inputs

Optional flags:

- `--target zod|nest|rxjs|all` — which upstream to audit. Default `all`.
- `--since <version>` — override the installed-version floor. Useful when comparing to a specific historical baseline.

## Workflow

### Step 1: Resolve installed versions

Read `package.json` and `package-lock.json`:

- `peerDependencies` give the supported range we claim.
- `devDependencies` give the version we test against.
- `package-lock.json` gives the actual resolved version in the working tree.

For each target in scope:

```
zod         peers: ">=4.4.0"   dev: "^4.4.0"   resolved: 4.4.X
@nestjs/swagger   peers: ">=8"      dev: "^11.0.0"  resolved: 11.X.Y
@nestjs/common    peers: ">=10"     dev: "^11.0.0"  resolved: 11.X.Y
@nestjs/core      peers: ">=10"     dev: "^11.0.0"  resolved: 11.X.Y
rxjs              peers: ">=7"      dev: "^7.8.1"   resolved: 7.X.Y
```

### Step 2: Fetch latest stable

For each target:

```bash
npm view <pkg> version
npm view <pkg> dist-tags.latest   # confirm we're using stable not pre-release
```

Record the gap: `installed → latest` (patch / minor / major).

### Step 3: Invoke the dedicated scanner (when applicable)

For each target that has a dedicated scanner skill, invoke it with the installed and latest versions. The scanners do the source-aware diff against our consumption:

| Target                                              | Scanner               | Hands off                                                                                                    |
| --------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `zod`                                               | `/scan-zod-features`  | Options-type diff for `z.toJSONSchema`, watched APIs (`.meta()`, registry, override hook).                   |
| `@nestjs/swagger`, `@nestjs/common`, `@nestjs/core` | `/scan-nest-features` | Shape diff of `_OPENAPI_METADATA_FACTORY`, `SchemaObjectFactory`, `Reflector`, pipe / interceptor contracts. |
| `rxjs`                                              | — (no scanner)        | Falls through to Step 4.                                                                                     |

Capture the scanner's findings inline in the report.

### Step 4: Changelog scrape (fallback)

For targets without a scanner, scrape upstream release notes. Priority order:

1. **GitHub Releases** — `gh release list -R <owner>/<repo> --limit 50` and read the body of every release between installed and latest.
2. **`CHANGELOG.md`** — read directly from the repo or `node_modules/<pkg>/CHANGELOG.md`.
3. **Conventional-commit diff** — `gh api repos/<owner>/<repo>/compare/v<installed>...v<latest>` and group by prefix.

Look specifically for:

- Items marked `BREAKING CHANGE`.
- Removed / renamed APIs.
- New APIs that touch the areas we consume (for rxjs: operators we use — `mergeMap`, `from`, `Observable`).
- Security advisories (`gh api repos/<owner>/<repo>/security-advisories`).

### Step 5: Cross-reference vs `src/`

For each candidate finding (breaking, removal, new API), grep `src/` for the symbol or pattern. The cross-reference determines the triage bucket:

- Finding affects code we touch → likely ⚠️ **Needs investigation** or 🚫 **Blocked**.
- Finding doesn't touch our code → either ✅ **Safe bump** (if no behavioural change) or 💡 **Opportunity** (if it's a new API that could simplify us).
- Patch / non-breaking minor with no finding → ✅ **Safe bump**.

### Step 6: Create one GitHub issue per actionable finding

Findings live in GitHub, not in committed files. Each finding gets its own issue so it can be searched, labelled, assigned, and closed independently. The audit trail is the issue history itself.

**Per-finding rules:**

| Category                   | Issue created?                                                                                     | Label(s)                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| ✅ **Safe bump**           | No — reported inline in the chat summary only.                                                     | n/a                                             |
| 💡 **Opportunity**         | No by default. **Ask the user** in the chat summary whether to file one; create only if confirmed. | `upstream-update`, `enhancement` (if confirmed) |
| ⚠️ **Needs investigation** | Yes — one issue per finding.                                                                       | `upstream-update`                               |
| 🚫 **Blocked**             | Yes — one issue per finding.                                                                       | `upstream-update`, `blocked`                    |

**One-time label seeding** (idempotent):

```bash
gh label create upstream-update --color "fbca04" --description "Upstream dependency audit findings" 2>/dev/null || true
gh label create blocked --color "b60205" --description "Cannot ship until resolved" 2>/dev/null || true
```

**Issue body template** (one per finding):

```markdown
**Package:** `<name>` `<installed>` → `<latest>` (`<gap>`)
**Source:** `/check-upstream-updates` on <YYYY-MM-DD>

## Finding

<one paragraph: what changed upstream, what we depend on>

## Impact on `src/`

<file:line refs from the cross-reference step, plus the scanner's diagnosis>

## Suggested action

<concrete next step — update a function, add a test fixture, drop a workaround, pin lower>

---

_Created automatically by the `/check-upstream-updates` skill._
```

Create with `gh issue create` and capture the URL:

```bash
gh issue create \
  --title "upstream(<pkg>): <one-line summary of the finding>" \
  --label upstream-update \
  --body-file <path/to/issue-body.md>
```

### Step 7: Emit the inline summary

After all issues are created, output a single chat-friendly summary so the user knows what landed:

```markdown
## /check-upstream-updates — <YYYY-MM-DD>

Targets audited: zod, @nestjs/swagger, @nestjs/common, @nestjs/core, rxjs

| Target          | Installed | Latest | Verdict          |
| --------------- | --------- | ------ | ---------------- |
| zod             | 4.4.2     | 4.5.0  | ⚠️ 1 issue filed |
| @nestjs/swagger | 11.0.3    | 11.0.5 | ✅ safe bump     |
| @nestjs/common  | 11.0.0    | 11.0.2 | ✅ safe bump     |
| @nestjs/core    | 11.0.0    | 11.0.2 | ✅ safe bump     |
| rxjs            | 7.8.1     | 7.8.2  | ✅ safe bump     |

**Issues filed:**

- #N — `upstream(zod): thread the new `cycles`option through`buildToJsonSchemaOptions``

**Safe bumps (apply in the next release, no issue needed):**

- `@nestjs/swagger` 11.0.3 → 11.0.5
- `@nestjs/common` 11.0.0 → 11.0.2
- `@nestjs/core` 11.0.0 → 11.0.2
- `rxjs` 7.8.1 → 7.8.2

**Opportunities (not filed — ask if you want issues):**

- `zod` 4.5.0 — `unionStrategy: 'oneOf-strict'` could simplify `src/schema/override.ts`.
```

The summary is the only artifact left in the chat. No files are written to the repo; no commits are made by the skill. The user reviews the issues and decides whether to act.

## Out of scope

- **Applying the bumps.** This skill _audits_; it doesn't update `package.json` or run `npm install`.
- **Scheduling.** Manual invocation only — no cron, no scheduled action.
- **Non-npm dependencies.** Only the packages listed in `package.json`. Repo-shared tooling (eslint, prettier, jest) isn't audited unless explicitly in scope via `--target`.
- **Security advisory triage.** Findings get flagged; remediation is a separate concern.

## Notes

- The cadence is deliberately manual. Automating this skill would create noise without commensurate value at this project's size.
- Findings use the same `✅ / ⚠️ / 💡 / 🚫` vocabulary as `/sync-docs` for consistency across the maintenance skill set.
- The audit trail is the GitHub issue history itself — searchable, labelable, closable. No committed report files.
