// deploy/deploy.sh and deploy/rollback.sh, run for real against a checkout of their own: git does what it does, while
// docker, curl and sleep are stand-ins that keep their state in files (which images exist under which name, what
// compose was asked to run, whether the site answers, what the registry and GitHub's attestations hold). What
// production relies on: no image (or one without CI's provenance), no change; the image that ran becomes the way back;
// an unhealthy deploy goes back by itself; a rollback runs what ran before.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const repo = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-deploy-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.test',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim();

/** A file in `dir`, committed and pushed: a new commit on the origin's main. Returns its full hash. */
function publishCommit(work: string, file: string, content: string): string {
  fs.writeFileSync(path.join(work, file), content);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', file);
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  return git(work, 'rev-parse', 'HEAD');
}

const stubs = path.join(tmp, 'bin');
const state = path.join(tmp, 'state');
fs.mkdirSync(stubs);
fs.mkdirSync(path.join(state, 'images'), { recursive: true });
const stub = (name: string, body: string) =>
  fs.writeFileSync(path.join(stubs, name), `#!/bin/sh\n${body}`, { mode: 0o755 });
// Images live in state/images, one file per name holding the image's id; state/registry lists what CI published
// (`<repository>:<tag> <id>`, the id standing in for the digest too), and state/attested the digests CI attested.
stub(
  'docker',
  `S="$STUB_STATE"
echo "docker $*" >>"$S/calls.log"
name() { printf '%s' "$1" | tr '/:' '__'; }
case "$1" in
  pull)
    [ "$2" = --quiet ] && img=$3 || img=$2
    case $img in
      *@*) id=$(grep "^\${img%@*}:[^ ]* \${img#*@}$" "$S/registry" | head -1 | cut -d' ' -f2) ;;
      *) id=$(sed -n "s|^$img ||p" "$S/registry" | head -1) ;;
    esac
    [ -n "$id" ] || exit 1
    echo "$id" >"$S/images/$(name "$img")" ;;
  image)
    case "$2" in
      inspect)
        if [ "$3" = -f ]; then img=$5; else img=$3; fi
        [ -f "$S/images/$(name "$img")" ] || exit 1
        if [ "$3" = -f ]; then cat "$S/images/$(name "$img")"; fi ;;
    esac ;;
  tag)
    [ -f "$S/images/$(name "$2")" ] || exit 1
    cp "$S/images/$(name "$2")" "$S/images/$(name "$3")" ;;
  rmi) rm -f "$S/images/$(name "$2")" ;;
  # The image checking the new question bank (deploy.sh): state/bank-refused, a bank it can't load.
  run) [ -f "$S/bank-refused" ] && exit 1 ;;
  compose)
    shift
    # The app's live report (deploy.sh asks it for a quiet moment): busy for as many asks as state/busy says.
    if [ "$1 $2 $3" = "exec -T app" ]; then
      n=$(cat "$S/busy" 2>/dev/null || echo 0)
      [ "$n" -gt 0 ] && echo "1 room match(es) under way" && echo $((n - 1)) >"$S/busy"
      exit 0
    fi
    echo "APP_RELEASE=\${APP_RELEASE:-} $*" >>"$S/compose.log"
    # Caddy refusing a config: state/caddy-refuses.
    [ "$1 $3 $5" = "exec caddy reload" ] && [ -f "$S/caddy-refuses" ] && exit 1 ;;
esac
exit 0
`,
);
// The registry (a tag's digest), GitHub's attestations, and the site, which answers through Caddy unless state/down
// says otherwise.
stub(
  'curl',
  `S="$STUB_STATE"
for a in "$@"; do url=$a; done
case $url in
  *ghcr.io/token*) echo '{"token":"t"}' ;;
  *ghcr.io/v2/*/manifests/*)
    path=\${url#https://ghcr.io/v2/}
    id=$(sed -n "s|^ghcr.io/\${path%/manifests/*}:\${path##*/manifests/} ||p" "$S/registry" | head -1)
    [ -n "$id" ] || exit 22
    printf 'HTTP/2 200\\r\\ndocker-content-digest: %s\\r\\n\\r\\n' "$id" ;;
  *api.github.com/*/attestations/*)
    # The statement names the workflow that built the image: main's ci.yml, or (state/attested-elsewhere) another one.
    repo=\${url#https://api.github.com/repos/}
    repo=\${repo%/attestations/*}
    if grep -qx "\${url##*/}" "$S/attested" 2>/dev/null; then workflow="ci.yml@refs/heads/main"
    elif grep -qx "\${url##*/}" "$S/attested-elsewhere" 2>/dev/null; then workflow="release.yml@refs/heads/main"
    else echo '{"attestations":[]}'; exit 0; fi
    statement=$(printf '{"predicate":{"runDetails":{"builder":{"id":"https://github.com/%s/.github/workflows/%s"}}}}' \
      "$repo" "$workflow" | base64 | tr -d '\n')
    printf '{"attestations":[{"bundle":{"dsseEnvelope":{"payload":"%s"}}}]}\n' "$statement" ;;
  *) [ -f "$S/down" ] && exit 7 ;;
esac
exit 0
`,
);
stub('sleep', 'exit 0\n');

// The origin (GitHub), a developer's clone to push from, and the server's checkout with the private bank inside.
const origin = path.join(tmp, 'origin.git');
const bankOrigin = path.join(tmp, 'bank.git');
const work = path.join(tmp, 'work');
const bankWork = path.join(tmp, 'bank-work');
const checkout = path.join(tmp, 'checkout');
for (const bare of [origin, bankOrigin]) git(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
git(tmp, 'clone', '-q', origin, work);
git(tmp, 'clone', '-q', bankOrigin, bankWork);
fs.mkdirSync(path.join(work, 'deploy'));
for (const script of ['deploy.sh', 'rollback.sh', 'pull-image.sh'])
  fs.copyFileSync(path.join(repo, 'deploy', script), path.join(work, 'deploy', script));
fs.writeFileSync(path.join(work, '.gitignore'), '/private/\n/.release\n/.release-previous\n/.env\n');
const first = publishCommit(work, 'app.txt', 'v1');
publishCommit(bankWork, 'questions.json', '[1]');
git(tmp, 'clone', '-q', origin, checkout);
git(checkout, 'clone', '-q', bankOrigin, 'private');
fs.writeFileSync(path.join(checkout, '.env'), 'DOMAIN=example.test\n');

let second = '';

const short = (commit: string) => commit.slice(0, 7);
const image = (commit: string) => `ghcr.io/almanac-bg/almanac:${commit}`;
const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null);
/** The id the image under this name has (null: no such name). */
const tagged = (name: string) => read(path.join(state, 'images', name.replaceAll('/', '_').replaceAll(':', '_')));
const compose = () => read(path.join(state, 'compose.log'))?.split('\n') ?? [];
/** CI published this commit's image, with this id (and attested it, unless told otherwise). */
const published = (commit: string, id: string, { attested = true } = {}) => {
  fs.appendFileSync(path.join(state, 'registry'), `${image(commit)} ${id}\n`);
  if (attested) fs.appendFileSync(path.join(state, 'attested'), `${id}\n`);
};

function run(script: string, ...args: string[]) {
  fs.rmSync(path.join(state, 'compose.log'), { force: true });
  const r = spawnSync('sh', [path.join(checkout, 'deploy', script), ...args], {
    env: { ...gitEnv, PATH: `${stubs}:${process.env.PATH}`, STUB_STATE: state },
    encoding: 'utf8',
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

test('deploys: the published image runs, and the one before stays as the way back', () => {
  fs.writeFileSync(path.join(state, 'registry'), '');
  // What runs now: the first commit's image.
  published(first, 'sha256:one');
  fs.writeFileSync(path.join(state, 'images', 'almanac_latest'), 'sha256:one\n');
  fs.writeFileSync(path.join(checkout, '.release'), `${short(first)}\n`);

  // A new commit CI hasn't published (yet): nothing changes, not even the checkout.
  second = publishCommit(work, 'app.txt', 'v2');
  const refused = run('deploy.sh');
  assert.equal(refused.status, 1);
  assert.match(refused.output, new RegExp(`No image for ${short(second)}`));
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), first, 'the checkout stays');
  assert.equal(tagged('almanac:latest'), 'sha256:one');
  assert.deepEqual(compose(), []);

  // Published: it runs, under its release, and the first one is kept.
  published(second, 'sha256:two');
  const deployed = run('deploy.sh');
  assert.equal(deployed.status, 0, deployed.output);
  assert.match(deployed.output, new RegExp(`deployed ${short(second)}`));
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), second);
  assert.equal(tagged('almanac:latest'), 'sha256:two');
  assert.equal(tagged('almanac:previous'), 'sha256:one');
  assert.equal(tagged(image(second)), null, 'only the two names keep an image');
  assert.equal(read(path.join(checkout, '.release')), short(second));
  assert.equal(read(path.join(checkout, '.release-previous')), short(first));
  assert.ok(compose().includes(`APP_RELEASE=${short(second)} up -d`), compose().join('\n'));
});

test('the same image again with new questions: the app restarts on them, and the way back stays', () => {
  const current = git(checkout, 'rev-parse', 'HEAD');
  publishCommit(bankWork, 'questions.json', '[1,2]');
  const again = run('deploy.sh');
  assert.equal(again.status, 0, again.output);
  assert.equal(tagged('almanac:previous'), 'sha256:one', 'not replaced by the image that runs');
  assert.equal(read(path.join(checkout, '.release-previous')), short(first));
  assert.ok(
    compose().includes(`APP_RELEASE=${short(current)} up -d --no-deps --force-recreate app`),
    compose().join('\n'),
  );
  assert.equal(git(path.join(checkout, 'private'), 'rev-parse', 'HEAD'), git(bankWork, 'rev-parse', 'HEAD'));
});

test('new questions the code can’t load: nothing changes, and the bank goes back to what it was', () => {
  const bank = path.join(checkout, 'private');
  const before = git(bank, 'rev-parse', 'HEAD');
  publishCommit(bankWork, 'questions.json', '[1,2,"broken"]');
  fs.writeFileSync(path.join(state, 'bank-refused'), '');
  try {
    const r = run('deploy.sh');
    assert.equal(r.status, 1);
    assert.match(r.output, /doesn't load the new question bank: nothing changed/);
    assert.equal(git(bank, 'rev-parse', 'HEAD'), before, 'the questions that run stay');
    assert.deepEqual(compose(), [], 'nothing restarted');
  } finally {
    fs.rmSync(path.join(state, 'bank-refused'));
    // The fix comes as the next commit.
    publishCommit(bankWork, 'questions.json', '[1,2,3]');
  }
});

test('new questions only, and the site stops answering: the questions go back, not the code', () => {
  const bank = path.join(checkout, 'private');
  const before = git(bank, 'rev-parse', 'HEAD');
  const running = tagged('almanac:latest');
  fs.writeFileSync(path.join(state, 'down'), '');
  try {
    const r = run('deploy.sh');
    assert.equal(r.status, 1);
    assert.match(r.output, /isn't answering on the new questions after 90 s: back to the questions before/);
    assert.doesNotMatch(r.output, /rolled back to/, 'the code was fine before them');
    assert.equal(git(bank, 'rev-parse', 'HEAD'), before);
    assert.equal(tagged('almanac:latest'), running, 'the same image');
    assert.equal(compose().at(-1)?.endsWith('up -d --no-deps --force-recreate app'), true, compose().join('\n'));
  } finally {
    fs.rmSync(path.join(state, 'down'));
  }
  // Back up: the questions of that commit go in with the next deploy.
  assert.equal(run('deploy.sh').status, 0);
});

test('a deploy that isn’t answering after 90 s goes back by itself', () => {
  const third = publishCommit(work, 'app.txt', 'v3');
  published(third, 'sha256:three');
  fs.writeFileSync(path.join(state, 'down'), '');
  try {
    const r = run('deploy.sh');
    assert.equal(r.status, 1);
    assert.match(r.output, new RegExp(`${short(third)} isn't answering through Caddy after 90 s`));
    assert.match(r.output, /rolled back to/);
    assert.equal(tagged('almanac:latest'), 'sha256:two', 'what ran before runs again');
    assert.equal(read(path.join(checkout, '.release')), short(second));
  } finally {
    fs.rmSync(path.join(state, 'down'));
  }
});

test('rollback: to what ran before; to a commit CI published, and only to one', () => {
  const back = run('rollback.sh', first);
  assert.equal(back.status, 0, back.output);
  assert.equal(tagged('almanac:latest'), 'sha256:one');
  assert.equal(tagged('almanac:previous'), 'sha256:two', 'what ran becomes the way back');
  assert.equal(read(path.join(checkout, '.release')), short(first));
  assert.ok(compose().includes(`APP_RELEASE=${short(first)} up -d --no-build app`), compose().join('\n'));

  const forward = run('rollback.sh');
  assert.equal(forward.status, 0, forward.output);
  assert.equal(tagged('almanac:latest'), 'sha256:two');
  assert.equal(read(path.join(checkout, '.release')), short(second));

  // A commit nobody published an image for (CI failed on it): nothing changes.
  const unpublished = publishCommit(work, 'app.txt', 'v4');
  git(checkout, 'fetch', '-q', 'origin');
  const refused = run('rollback.sh', unpublished);
  assert.equal(refused.status, 1);
  assert.match(refused.output, new RegExp(`No image for ${short(unpublished)}`));
  assert.equal(tagged('almanac:latest'), 'sha256:two');

  fs.rmSync(path.join(state, 'images', 'almanac_previous'));
  const nothing = run('rollback.sh');
  assert.equal(nothing.status, 1);
  assert.match(nothing.output, /No previous image to go back to/);
});

test('a changed Caddyfile is reloaded into Caddy; one it refuses fails the deploy, and an unchanged one is left alone', () => {
  const reload = 'exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile';
  fs.mkdirSync(path.join(work, 'deploy'), { recursive: true });
  const withCaddy = publishCommit(work, 'deploy/Caddyfile', 'example.test {\n}\n');
  published(withCaddy, 'sha256:caddy-1');
  const changed = run('deploy.sh');
  assert.equal(changed.status, 0, changed.output);
  assert.ok(
    compose().some((line) => line.endsWith(reload)),
    compose().join('\n'),
  );

  const other = publishCommit(work, 'app.txt', 'v5');
  published(other, 'sha256:caddy-2');
  const same = run('deploy.sh');
  assert.equal(same.status, 0, same.output);
  assert.ok(!compose().some((line) => line.endsWith(reload)), 'the same Caddyfile: no reload');

  const broken = publishCommit(work, 'deploy/Caddyfile', 'example.test {\n');
  published(broken, 'sha256:caddy-3');
  fs.writeFileSync(path.join(state, 'caddy-refuses'), '');
  try {
    const refused = run('deploy.sh');
    assert.equal(refused.status, 1);
    assert.match(refused.output, /Caddy refused the new deploy\/Caddyfile and kept the old one/);
  } finally {
    fs.rmSync(path.join(state, 'caddy-refuses'));
  }
});

test('a deploy waits for a quiet moment (a class mid-match), up to 20 minutes; --now doesn’t wait', () => {
  const current = git(checkout, 'rev-parse', 'HEAD');
  const next = publishCommit(work, 'app.txt', 'v-quiet');
  published(next, 'sha256:quiet');
  try {
    // Busy for good: nothing changes.
    fs.writeFileSync(path.join(state, 'busy'), '1000');
    const refused = run('deploy.sh');
    assert.equal(refused.status, 1);
    assert.match(refused.output, /waiting for a quiet moment[\s\S]*1 room match\(es\) under way/);
    assert.match(refused.output, /still not quiet after 20 minutes: nothing deployed/);
    assert.equal(git(checkout, 'rev-parse', 'HEAD'), current, 'the checkout stays');
    assert.deepEqual(compose(), []);

    // Quiet after a few minutes: then it goes ahead.
    fs.writeFileSync(path.join(state, 'busy'), '3');
    const waited = run('deploy.sh');
    assert.equal(waited.status, 0, waited.output);
    assert.match(waited.output, /quiet now[\s\S]*deployed/);

    // --now: no asking at all.
    const again = publishCommit(work, 'app.txt', 'v-now');
    published(again, 'sha256:now');
    fs.writeFileSync(path.join(state, 'busy'), '1000');
    const now = run('deploy.sh', '--now');
    assert.equal(now.status, 0, now.output);
    assert.doesNotMatch(now.output, /waiting/);
    assert.equal(git(checkout, 'rev-parse', 'HEAD'), again);
    assert.equal(run('deploy.sh', '--later').status, 2, 'an unknown option');
  } finally {
    fs.rmSync(path.join(state, 'busy'), { force: true });
  }
});

test('a self-hosted copy: its own image (IMAGE in .env), and a question bank that is a file, not a clone', () => {
  const env = path.join(checkout, '.env');
  const bankGit = path.join(checkout, 'private', '.git');
  const away = path.join(tmp, 'bank-git-away');
  fs.writeFileSync(env, 'DOMAIN=example.test\nIMAGE=ghcr.io/someone/almanac\n');
  fs.renameSync(bankGit, away);
  try {
    const fork = publishCommit(work, 'app.txt', 'v-fork');
    fs.appendFileSync(path.join(state, 'registry'), `ghcr.io/someone/almanac:${fork} sha256:fork\n`);
    fs.appendFileSync(path.join(state, 'attested'), 'sha256:fork\n');
    const deployed = run('deploy.sh');
    assert.equal(deployed.status, 0, deployed.output);
    assert.equal(tagged('almanac:latest'), 'sha256:fork', 'the fork’s image runs');
    assert.equal(git(checkout, 'rev-parse', 'HEAD'), fork);
    assert.equal(fs.existsSync(bankGit), false, 'the bank was left as it is');
  } finally {
    fs.renameSync(away, bankGit);
    fs.writeFileSync(env, 'DOMAIN=example.test\n');
  }
});

test('an image attested by some other workflow than main’s CI isn’t deployed (GH-7)', () => {
  const current = git(checkout, 'rev-parse', 'HEAD');
  const running = tagged('almanac:latest');
  const elsewhere = publishCommit(work, 'app.txt', 'v-other-workflow');
  published(elsewhere, 'sha256:elsewhere', { attested: false });
  fs.appendFileSync(path.join(state, 'attested-elsewhere'), 'sha256:elsewhere\n');
  const refused = run('deploy.sh', '--now');
  assert.equal(refused.status, 1);
  assert.match(refused.output, /no build provenance/);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), current);
  assert.equal(tagged('almanac:latest'), running);
});

test('an image without CI’s build provenance isn’t deployed; a rollback to one takes --unverified', () => {
  const current = git(checkout, 'rev-parse', 'HEAD');
  const running = tagged('almanac:latest');
  const pushed = publishCommit(work, 'app.txt', 'v-pushed-by-hand');
  published(pushed, 'sha256:unattested', { attested: false });
  const refused = run('deploy.sh', '--now');
  assert.equal(refused.status, 1);
  assert.match(refused.output, /no build provenance/);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), current, 'the checkout stays');
  assert.equal(tagged('almanac:latest'), running);

  const back = run('rollback.sh', pushed);
  assert.equal(back.status, 1);
  assert.match(back.output, /add --unverified/);
  assert.equal(tagged('almanac:latest'), running);
  const taken = run('rollback.sh', pushed, '--unverified');
  assert.equal(taken.status, 0, taken.output);
  assert.equal(tagged('almanac:latest'), 'sha256:unattested');
});
