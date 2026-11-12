// Commits on main follow Conventional Commits 1.0 (https://www.conventionalcommits.org): `type(scope): summary`.
// A pull request's title becomes its squash commit, so CI checks every title against this (.github/workflows/
// pr-title.yml), and release-please reads the types to choose the next version and write the changelog.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "revert"]],
    // Where the change is; none for one that spans the repository.
    "scope-enum": [2, "always", ["web", "server", "bank", "game", "deploy", "ci", "docs", "deps", "security", "release"]],
    // Dependabot's group titles run past 72; a person's title aims for 72.
    "header-max-length": [2, "always", 100],
    "subject-case": [2, "never", ["sentence-case", "start-case", "pascal-case", "upper-case"]],
  },
};
