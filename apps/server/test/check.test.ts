// deploy/check.sh, the server's daily check, run for real against a host of stand-ins: openssl, docker, apt, curl,
// timedatectl and df answer from files, and the host's own files (dpkg, unattended-upgrades, the stamps) sit under
// CHECK_ROOT. What it must catch, each said on the heartbeat's /fail: a certificate (the apex's or www's) running out,
// a clock off, and the security updates no longer installing — an install cut short, a nightly run that stopped or
// failed, an update left waiting (the 31 October review, OPS-2 and OPS-9).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-check-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const source = path.resolve(import.meta.dirname, '../../../deploy');
const repo = path.join(tmp, 'repo');
const host = path.join(tmp, 'host');
const state = path.join(tmp, 'state');
const stubs = path.join(tmp, 'bin');
fs.mkdirSync(path.join(repo, 'deploy'), { recursive: true });
fs.copyFileSync(path.join(source, 'check.sh'), path.join(repo, 'deploy/check.sh'));
fs.copyFileSync(path.join(source, 'Caddyfile'), path.join(repo, 'deploy/Caddyfile'));
fs.writeFileSync(path.join(repo, '.env'), 'DOMAIN=example.test\nCOMPOSE_PROFILES=backup\n');
fs.mkdirSync(stubs);
const stub = (name: string, body: string) =>
  fs.writeFileSync(path.join(stubs, name), `#!/bin/sh\nS="$STUB_STATE"\n${body}`, { mode: 0o755 });

// A certificate per name it's asked for, unless state/no-cert lists the name; state/expiring, the ones near their end.
stub(
  'openssl',
  `case "$1" in
  s_client)
    prev=; for a; do [ "$prev" = -servername ] && name=$a; prev=$a; done
    grep -qx "$name" "$S/no-cert" 2>/dev/null || echo "CERT $name" ;;
  x509)
    input=$(cat); [ -n "$input" ] || exit 1; name=\${input#CERT }
    case " $* " in
      *" -checkend "*) ! grep -qx "$name" "$S/expiring" 2>/dev/null ;;
      *" -enddate "*) echo "notAfter=Nov 20 00:00:00 2026 GMT" ;;
      *) echo "$input" ;;
    esac ;;
esac`,
);
stub('timedatectl', 'cat "$S/ntp" 2>/dev/null || echo yes');
stub('df', "printf 'Use%%\\n 40%%\\n'");
stub('apt', 'echo "Listing..."; cat "$S/upgradable" 2>/dev/null; true');
// The heartbeat's pings are kept; Cloudflare's lists don't come (the comparison with them is skipped).
stub(
  'curl',
  `echo "$*" >>"$S/curl.log"
case "$*" in *cloudflare.com*) exit 1 ;; esac`,
);
stub(
  'docker',
  `case "$*" in
  "compose ps --status running -q "*) echo id ;;
  "compose ps -q app") echo app ;;
  "inspect -f {{.State.OOMKilled}} app") echo false ;;
  "inspect -f {{.RestartCount}} app") echo 0 ;;
  "compose exec -T app sh -c"*) echo 3 ;;
  "compose exec -T app du"*) printf '1.0G\\t/data\\n' ;;
esac`,
);

const DAY = 24 * 60 * 60_000;
const log = path.join(host, 'var/log/unattended-upgrades/unattended-upgrades.log');
const updates = path.join(host, 'var/lib/dpkg/updates');
const stamp = path.join(host, 'var/tmp/almanac-security-update');
const at = (file: string, ago: number) => fs.utimesSync(file, (Date.now() - ago) / 1000, (Date.now() - ago) / 1000);

beforeEach(() => {
  fs.rmSync(host, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
  fs.mkdirSync(state);
  fs.mkdirSync(updates, { recursive: true });
  fs.mkdirSync(path.join(host, 'var/tmp'), { recursive: true });
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(
    log,
    [
      '2026-11-01 06:10:00,000 INFO Starting unattended upgrades script',
      '2026-11-01 06:10:05,000 ERROR An error that the next run got past',
      '2026-11-02 06:10:00,000 INFO Starting unattended upgrades script',
      '2026-11-02 06:10:09,000 INFO No packages found that can be upgraded unattended and no pending auto-removals',
      '',
    ].join('\n'),
  );
});

/** check.sh as cron runs it, with a heartbeat: whether it passed, and what the heartbeat heard. */
function check() {
  const r = spawnSync('sh', [path.join(repo, 'deploy/check.sh'), 'https://beat.example.test/h'], {
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, STUB_STATE: state, CHECK_ROOT: host },
    encoding: 'utf8',
  });
  const pings = fs.existsSync(path.join(state, 'curl.log'))
    ? fs
        .readFileSync(path.join(state, 'curl.log'), 'utf8')
        .split('\n')
        .filter((l) => l.includes('beat.example.test'))
    : [];
  fs.rmSync(path.join(state, 'curl.log'), { force: true });
  return { ok: r.status === 0, out: r.stdout + r.stderr, pings };
}
/** A failed check: the reason it gave, which went to the heartbeat's /fail. */
function failed(reason: RegExp) {
  const r = check();
  assert.equal(r.ok, false, r.out);
  assert.match(r.out, reason);
  assert.equal(r.pings.length, 1);
  assert.match(r.pings[0], /https:\/\/beat\.example\.test\/h\/fail$/);
  assert.match(r.pings[0], reason);
}

test('a sound host passes and pings the heartbeat; an error in an earlier run of the updates doesn’t count', () => {
  const r = check();
  assert.ok(r.ok, r.out);
  assert.match(r.out, /check ok \(disk 40% full, data 1\.0G\)/);
  assert.deepEqual(
    r.pings.map((p) => p.endsWith('https://beat.example.test/h')),
    [true],
  );
});

test('both certificates are checked, the apex’s and www’s, and the clock', () => {
  fs.writeFileSync(path.join(state, 'expiring'), 'www.example.test\n');
  failed(/the certificate for www\.example\.test expires Nov 20 00:00:00 2026 GMT/);
  fs.rmSync(path.join(state, 'expiring'));
  fs.writeFileSync(path.join(state, 'no-cert'), 'www.example.test\n');
  failed(/no certificate for www\.example\.test/);
  fs.rmSync(path.join(state, 'no-cert'));
  fs.writeFileSync(path.join(state, 'ntp'), 'no\n');
  failed(/the clock isn't synchronized/);
});

test('the security updates stopping is caught: an install cut short, a run that stopped or failed', () => {
  fs.writeFileSync(path.join(updates, '0001'), '');
  failed(/an install was cut short: run dpkg --configure -a/);
  fs.rmSync(path.join(updates, '0001'));

  at(log, 3 * DAY);
  failed(/the security updates haven't run for 3 days/);

  fs.appendFileSync(
    log,
    '2026-11-03 06:10:00,000 INFO Starting unattended upgrades script\n2026-11-03 06:10:03,000 ERROR dpkg returned an error code\n',
  );
  failed(/the security updates' last run failed: 2026-11-03 06:10:03,000 ERROR dpkg returned an error code/);

  fs.rmSync(log);
  failed(/no log of the security updates/);
});

test('a security update left waiting: fine for a day, an alarm after two; gone, the count starts over', () => {
  fs.writeFileSync(
    path.join(state, 'upgradable'),
    'linux-image-virtual/resolute-updates,resolute-security 7.0.0-43.43 amd64 [upgradable from: 7.0.0-38.38]\n' +
      'tmux/resolute-updates 3.6a-2ubuntu0.2 amd64 [upgradable from: 3.6a-2]\n',
  );
  assert.ok(check().ok, 'just seen');
  assert.ok(fs.existsSync(stamp));
  fs.writeFileSync(stamp, String(Math.floor((Date.now() - 3 * DAY) / 1000)));
  failed(/security updates have been waiting 3 days: linux-image-virtual(?! tmux)/);

  // Only -updates left (not security's): no alarm, and the next security update is counted from when it comes.
  fs.writeFileSync(path.join(state, 'upgradable'), 'tmux/resolute-updates 3.6a-2ubuntu0.2 amd64\n');
  assert.ok(check().ok);
  assert.ok(!fs.existsSync(stamp));
});
