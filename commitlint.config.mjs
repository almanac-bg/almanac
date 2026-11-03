// Commit messages on main follow Conventional Commits 1.0 (https://www.conventionalcommits.org): `type(scope): summary`.
// With squash merges a pull request's title becomes its commit on main, so CI checks every title against this
// (.github/workflows/ci.yml → "PR title"); release-please reads the types to choose the next version and write the
// changelog (release-please-config.json). How to write one: CONTRIBUTING.md → Commits and pull requests.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert']],
    // Where the change is; none for one that spans the whole repo.
    'scope-enum': [
      2,
      'always',
      ['web', 'server', 'client', 'shared', 'bank', 'deploy', 'ci', 'docs', 'deps', 'e2e', 'security', 'release'],
    ],
    // commitlint's own limit: Dependabot's group titles run past 72 ("… in the npm-minor group"), and nobody can
    // shorten those. A person's title aims for 72, a line a log shows whole (CONTRIBUTING.md).
    'header-max-length': [2, 'always', 100],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
  },
};
