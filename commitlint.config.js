/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Conventional's default is 100; we use 140 so PR titles can comfortably
    // carry a scope + decorator name + short summary without truncation.
    // Squash-merge titles still land in `git log` — the looser cap trades
    // some scan density for not nagging on titles like
    // `feat(decorators): @ZodResponse auto-applies @ApiResponse for OpenAPI emission`.
    'header-max-length': [2, 'always', 140],
    // Disable subject-case. Project house style routinely uses acronyms
    // (`PR`, `CI`, `OpenAPI`, `README`, `CLAUDE.md`) and proper nouns in
    // squash-merge titles — see PRs #25, #27, #28. The conventional
    // default rule fails on any of those.
    'subject-case': [0],
  },
};
