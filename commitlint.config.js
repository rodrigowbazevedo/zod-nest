/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Match the 70-char PR-title convention from CLAUDE.md. Conventional's
    // default is 100; we want the tighter limit so squash-merge titles
    // (which become commit subjects on main) stay scannable in `git log`.
    'header-max-length': [2, 'always', 70],
  },
};
