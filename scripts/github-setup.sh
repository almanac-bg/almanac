#!/usr/bin/env bash
# Sets up a GitHub repository for АЛМАНАХ: About (description, website, topics), features, merge rules, security
# features, labels and a protected main branch. Safe to run again. Needs the GitHub CLI (gh), logged in as an admin.
#
#   scripts/github-setup.sh almanac-bg/almanac
#
# Some features exist only for public repositories (private vulnerability reporting, free secret scanning, rules on
# private repositories without a paid plan): on a private one those steps say so and are skipped.
set -uo pipefail

repo=${1:?usage: scripts/github-setup.sh <owner/repo>}
ok() { printf '  ✓ %s\n' "$1"; }
skip() { printf '  – %s (%s)\n' "$1" "$2"; }
try() { # try <label> <command…>: runs it, reporting success or GitHub's reason
  local label=$1
  shift
  local out
  if out=$("$@" 2>&1); then ok "$label"; else skip "$label" "$(echo "$out" | grep -oE '"message":"[^"]*"' | head -1 | cut -d'"' -f4 || echo failed)"; fi
}

echo "About"
try "description, website and topics" gh repo edit "$repo" \
  --description "АЛМАНАХ — куиз битки в реално време: дуели, Роял за 8 играчи, дневно предизвикателство и предизвикателства с линк. React, Node.js, Socket.IO, SQLite." \
  --homepage "https://almanac.bg" \
  --add-topic quiz,trivia,quiz-game,multiplayer-game,realtime,browser-game,bulgaria,bulgarian,react,typescript,nodejs,socket-io,sqlite,vite,tailwindcss,pwa,self-hosted,agpl

echo "Features and merging"
# Issues and Discussions for the community; the docs live in the repository, so no wiki or projects. Squash merges
# keep main's history one commit per change; merged branches are deleted; Dependabot pull requests can auto-merge.
try "issues and discussions on, wiki and projects off" gh repo edit "$repo" \
  --enable-issues --enable-discussions --enable-wiki=false --enable-projects=false
try "squash merges only, branches deleted after merge, auto-merge allowed" gh repo edit "$repo" \
  --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge --enable-auto-merge
try "squash commits titled after the pull request" gh api -X PATCH "repos/$repo" \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY

echo "Security"
try "Dependabot alerts" gh api -X PUT "repos/$repo/vulnerability-alerts"
try "Dependabot security updates" gh api -X PUT "repos/$repo/automated-security-fixes"
try "private vulnerability reporting (SECURITY.md points to it)" gh api -X PUT "repos/$repo/private-vulnerability-reporting"
try "secret scanning with push protection" gh api -X PATCH "repos/$repo" --input - <<'JSON'
{"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}}
JSON

# A private vulnerability report notifies only those who watch the repository (all activity, or Custom → Security
# alerts), and so does every outside issue and pull request: until 31 October nobody watched, so SECURITY.md's first
# channel reached no one (the review's GH-2). This watches it for whoever runs the script. GitHub's API needs the
# notifications scope for it: `gh auth refresh -h github.com -s notifications`, or the Watch button (Custom → Security
# alerts) on the repository's page. Where the mail goes: github.com/settings/notifications → Custom routing.
try "watched by you (vulnerability reports, issues and pull requests reach you)" gh api -X PUT \
  "repos/$repo/subscription" -F subscribed=true -F ignored=false

# CodeQL: GitHub's own security analysis of the code, on every push and pull request (free for public repositories),
# with the extended set of queries (more findings, some of them to dismiss; docs/maintainers.md says how).
try "code scanning (CodeQL, extended queries)" gh api -X PATCH "repos/$repo/code-scanning/default-setup" \
  -f state=configured -f query_suite=extended

echo "Labels"
label() { try "label: $1" gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force; }
label bug d73a4a "Нещо не работи както трябва"
label enhancement a2eeef "Нова възможност или подобрение"
label ux 8b5cf6 "Изглед, достъпност, текстове, телефони"
label game-balance f59e0b "Точки, рейтинг, XP, ботове, търсене на съперници"
label questions 34d399 "Въпросите в играта и предложените от играчите"
label security b60205 "Сигурност или поверителност"
label dependencies 0366d6 "Обновяване на зависимости (Dependabot)"
label "good first issue" 7057ff "Малка, ясна задача за начало"

echo "Branch protection"
# Two rulesets. "main: history": main can't be deleted or force-pushed, by anyone — no bypass, admins included, so its
# history is never rewritten (until 31 October one ruleset held both, and its admin bypass covered the history too: the
# review's GH-1). "main: checks": a pull request merges only once CI passed, in all three browsers too, and CodeQL found
# nothing high or critical (Dependabot's auto-merge included); admins bypass these, so a maintainer can still push a
# fast-forward straight to main. Each check must come from GitHub Actions (integration 15368), not a status anyone with
# write access could post under the same name (GH-9).
history=$(cat <<'JSON'
{
  "name": "main: history",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "bypass_actors": [],
  "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}]
}
JSON
)
checks=$(cat <<'JSON'
{
  "name": "main: checks",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}],
  "rules": [
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "do_not_enforce_on_create": false,
      "required_status_checks": [
        {"context": "test (Node 24)", "integration_id": 15368}, {"context": "test (Node 26)", "integration_id": 15368},
        {"context": "docker", "integration_id": 15368},
        {"context": "browser tests (webkit 1/2)", "integration_id": 15368},
        {"context": "browser tests (webkit 2/2)", "integration_id": 15368},
        {"context": "browser tests (firefox 1/2)", "integration_id": 15368},
        {"context": "browser tests (firefox 2/2)", "integration_id": 15368}
      ]
    }},
    {"type": "code_scanning", "parameters": {"code_scanning_tools": [
      {"tool": "CodeQL", "security_alerts_threshold": "high_or_higher", "alerts_threshold": "errors"}
    ]}}
  ]
}
JSON
)
rulesets=$(gh api "repos/$repo/rulesets" -q '.[] | "\(.id) \(.name)"' 2>/dev/null)
apply() { # apply <name> <label> <json>: replaces the ruleset of that name, or makes it
  local id
  id=$(awk -v n="$1" '{ id = $1; $1 = ""; sub(/^ /, ""); if ($0 == n) print id }' <<<"$rulesets")
  if [ -n "$id" ]; then try "$2" gh api -X PUT "repos/$repo/rulesets/$id" --input - <<<"$3"
  else try "$2" gh api -X POST "repos/$repo/rulesets" --input - <<<"$3"; fi
}
apply "main: history" "main's history can't be rewritten or deleted, by anyone" "$history"
apply "main: checks" "main needs green CI and CodeQL (admins may push past them)" "$checks"
# The single ruleset of before 31 October, now split in two.
old=$(awk '{ id = $1; $1 = ""; sub(/^ /, ""); if ($0 == "Protect main") print id }' <<<"$rulesets")
[ -z "$old" ] || try "the old combined ruleset removed" gh api -X DELETE "repos/$repo/rulesets/$old"

echo "Actions"
# Only GitHub's own and verified creators' actions, each pinned to a commit (a tag can be moved); Dependabot keeps the
# commits current.
try "only GitHub-owned and verified actions, pinned to a commit" gh api -X PUT "repos/$repo/actions/permissions" \
  --input - <<<'{"enabled": true, "allowed_actions": "selected", "sha_pinning_required": true}'
# GitHub's own only: every action CI uses is (actions/*), and a "verified creator" is a badge, not a review (GH-9).
try "which ones: GitHub's own" gh api -X PUT "repos/$repo/actions/permissions/selected-actions" \
  --input - <<<'{"github_owned_allowed": true, "verified_allowed": false, "patterns_allowed": []}'
# A pull request from someone outside runs CI only once a maintainer approves it, every time, not only for a first
# contribution: needed before any release secret exists (GH-8).
try "outside contributors' pull requests run CI only once approved" gh api -X PUT \
  "repos/$repo/actions/permissions/fork-pr-contributor-approval" --input - <<<'{"approval_policy": "all_external_contributors"}'

echo
echo "By hand (GitHub has no API for it): Settings → General → Social preview → upload .github/social-preview.png"
