#!/usr/bin/env bash
# Sets up a GitHub repository for АЛМАНАХ: About (description, website, topics), features, merge rules, security
# features, labels and a protected main branch. Safe to run again. Needs the GitHub CLI (gh), logged in as an admin.
#
#   scripts/github-setup.sh otsirh/quiz          # the private development repository
#   scripts/github-setup.sh otsirh/almanac       # the public one, after scripts/publish-public.sh
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
  --description "АЛМАНАХ ⚡ Real-time multiplayer quiz battles in Bulgarian: duels, an 8-player Royale, a daily challenge and challenge links. React, Node.js, Socket.IO, SQLite." \
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

echo "Labels"
label() { try "label: $1" gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force; }
label bug d73a4a "Something doesn't work as it should"
label enhancement a2eeef "A new feature or an improvement"
label ux 8b5cf6 "Layout, accessibility, wording, mobile"
label game-balance f59e0b "Scoring, ratings, XP, bots, matchmaking"
label questions 34d399 "The question bank and community questions"
label security b60205 "Security or privacy"
label dependencies 0366d6 "Dependency updates (Dependabot)"
label "good first issue" 7057ff "A small, well-defined place to start"

echo "Branch protection"
# main can't be deleted or force-pushed (history is never rewritten); pushing and merging stay as they are.
if gh api "repos/$repo/rulesets" -q '.[].name' 2>/dev/null | grep -qx "Protect main"; then
  ok "main is protected (rule already there)"
else
  try "main can't be deleted or force-pushed" gh api -X POST "repos/$repo/rulesets" --input - <<'JSON'
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}]
}
JSON
fi

echo
echo "By hand (GitHub has no API for it): Settings → General → Social preview → upload .github/social-preview.png"
