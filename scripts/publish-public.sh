#!/usr/bin/env bash
# Makes the public copy of this repository: everything tracked except private/ (the question bank), as a fresh git
# repository with one commit. Push it to the public GitHub repository yourself after a look.
#
#   scripts/publish-public.sh ../almanac-public
#   cd ../almanac-public && git remote add origin git@github.com:<you>/almanac.git && git push -u origin main
set -euo pipefail

target=${1:?usage: scripts/publish-public.sh <empty folder>}
root=$(git rev-parse --show-toplevel)
if [ -e "$target" ] && [ -n "$(ls -A "$target")" ]; then
  echo "$target is not empty" >&2
  exit 1
fi
if [ -n "$(git -C "$root" status --porcelain)" ]; then
  echo "Commit or stash your changes first: the copy is made from the last commit." >&2
  exit 1
fi

mkdir -p "$target"
# .gitattributes marks private/ export-ignore, so the archive leaves it out.
git -C "$root" archive HEAD | tar -x -C "$target"

# The question bank must never go public: the only questions in the copy may be the public sample's.
sample="$target/apps/server/src/data/questions.sample.json"
in_sample=$(grep -o '"answer":' "$sample" | wc -l)
in_copy=$(grep -rho --include='*.json' '"answer":' "$target" | wc -l)
if [ -e "$target/private" ] || [ "$in_copy" -ne "$in_sample" ] || [ "$in_sample" -gt 200 ]; then
  echo "Questions beyond the public sample ended up in the copy ($in_copy, sample $in_sample) — stopping." >&2
  rm -rf "$target"
  exit 1
fi

cd "$target"
git init -q -b main
git add -A
# The commit is signed with your git identity. To keep your email private, give GitHub's "noreply" address:
#   GIT_AUTHOR_EMAIL=<id>+<you>@users.noreply.github.com GIT_COMMITTER_EMAIL=<same> scripts/publish-public.sh <folder>
git commit -q -m "АЛМАНАХ — public source, $(git -C "$root" log -1 --format=%cs)"
echo "Public copy ready in $target ($(git ls-files | wc -l | tr -d ' ') files). Review it, then add the remote and push."
