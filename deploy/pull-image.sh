#!/bin/sh
# Pulls the image CI published for a commit (for deploy/deploy.sh and deploy/rollback.sh) and prints the name it's
# under. IMAGE in .env says whose (a fork's own; by default ghcr.io/almanac-bg/almanac). On ghcr.io it goes by digest,
# and only with GitHub's build-provenance attestation for that digest in the image's own repository, which CI's
# publish job makes: a tag can be pushed again by anyone who can write to the package, while the attestation comes
# only from a workflow in the repository — main's ci.yml, which it must name. Exits 1 when there's no such image, 3
# when it isn't attested.
# The full cryptographic check, by hand: gh attestation verify oci://<image>:<commit> --repo <owner>/<repository>
set -eu
commit=$1
repo=$(sed -n 's/^IMAGE=//p' .env 2>/dev/null | tail -1)
repo=${repo:-ghcr.io/almanac-bg/almanac}
case $repo in
  ghcr.io/*)
    path=${repo#ghcr.io/}
    # A public package needs no account: an anonymous token reads it.
    token=$(curl -fsS "https://ghcr.io/token?scope=repository:$path:pull" 2>/dev/null |
      sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
    digest=$(curl -fsSI -H "Authorization: Bearer $token" \
      -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
      "https://ghcr.io/v2/$path/manifests/$commit" 2>/dev/null | tr -d '\r' |
      sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: *//p')
    [ -n "$digest" ] || exit 1
    # Made by main's CI and by nothing else: the attestation's statement names the workflow and branch that built
    # the image (its builder), and any other workflow or branch of the repository could make one too (the 31 October
    # review, GH-7). The signature itself is checked by hand with the command above.
    builder="\"id\":\"https://github.com/$path/.github/workflows/ci.yml@refs/heads/main\""
    attested=no
    for payload in $(curl -fsS "https://api.github.com/repos/$path/attestations/$digest" 2>/dev/null |
      grep -o '"payload":"[^"]*"' | sed 's/^"payload":"//; s/"$//'); do
      if printf '%s' "$payload" | base64 -d 2>/dev/null | grep -q -F "$builder"; then attested=yes; fi
    done
    [ "$attested" = yes ] || exit 3
    image="$repo@$digest"
    ;;
  *) image="$repo:$commit" ;;
esac
docker pull --quiet "$image" >/dev/null || exit 1
echo "$image"
