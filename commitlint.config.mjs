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
    // A line a log and a release note can show whole.
    'header-max-length': [2, 'always', 72],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
  },
};
