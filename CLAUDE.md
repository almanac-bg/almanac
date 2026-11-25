# АЛМАНАХ

A quiz game for Bulgarian players, live at [almanac.bg](https://almanac.bg). It's built almost entirely by AI
sessions, several at once, and the session owns the product (DECISIONS.md, first bullet): it decides what the game
is, designs it, builds it, tests it and ships it, all the way to production. Decide; say why in a line; act. The
owner provides money and access only: ask for those as one short, concrete step, never for a product decision.

This file is the way in. Read it first; it says where everything else is. `DECISIONS.md` holds the owner's calls and
their reasons: read it before changing what a player sees or how the game plays, and don't undo one on your own.
Where two written sources disagree, DECISIONS.md wins over every other, memory included, and `web/DESIGN.md` over
comments; the code and its tests are what runs. The stale copy is fixed in the pull request that finds it, but code
that has drifted from DECISIONS.md is said to the owner, never settled either way. Memory is for this machine and
how to work with the owner: a product call goes in DECISIONS.md.

## The game, in a paragraph

Every day ten questions; each one a player gets right in the issue writes its fact in ink in their Алманах, and their
rank in a chapter says how much of it the book holds in ink; played alone, with friends, beside all of Bulgaria. Three
places: Днес (the day's issue, the same ten for everyone, asked once, its result shared without the answers, and on it the
day's board), Алманах (the player's book: a chapter per subject, ink from the issues, every other fact met in grey, a seal
per chapter named for the book), Приятели (friends, and duels with them on one's own time, on one
page). The streak is the habit and forgives two missed days a week. The score is the number right; nothing
else adds up but ink and the streak. DECISIONS.md, „The direction“, is final: it lists the player's nouns and the rule
every later change passes.

## Direction

The day's ten questions are the heart of the game: the habit a player comes back for. Everything
else serves it or stays out of its way. The game already has many systems; a new one must replace something or prove
it's needed, and quiet beats loud (a new player sees the day and the chapters first, a game's news is three cards at
most). A change is judged by whether players come back: the retention numbers in `/admin`.

## Where things are

| Path | What |
| --- | --- |
| `cmd/almanac` | The program: `serve`, the bank's tools, backups, a player's deletion; `almanac` with no arguments lists every command (its doc comment says what each does) |
| `cmd/build` | Builds the client into `internal/assets/dist` (esbuild; precompressed; the first screen's budget, which is the player's whole client, and the fonts' ceiling) |
| `internal/play` | The game's rules and data: runs and their scores (`play.go`, `board.go`), the streak (`runs.go`), the Алманах, its ink and seals (`almanac.go`, `ink.go`, `rank.go`), duels on one's own time (`duels.go`: a friend's, challenged directly), friends |
| `internal/server` | HTTP: the API (`api.go` maps errors to Bulgarian messages), routes (`server.go`), pages (`pages.go`: the paths it sends the app for, the client's router's list again; a test holds them equal) |
| `internal/store` | SQLite; migrations in `internal/store/migrations`, applied once each by name |
| `internal/bank` | Question types, the bank on disk, its checks |
| `internal/card` | The game's icons (`icon.go`: drawn, never by hand) and the pictures a link shows (1200 × 630 PNG): a shared day's card, which the browser also shares as the day's picture (`/card/<issue>-<shape>.png`), and the site's own (`/og.png`); drawn in Go with the game's fonts (static cuts made by `web/src/fonts/subset.sh`) and the chapters' glyphs (`glyphs.json`, from `art/pictures.ts`) |
| `internal/account`, `mail`, `push`, `backup` | Players and sign-in, email, Web Push, backups to R2 (each checked before it's sent, encrypted to a key kept off the server, one brought back daily) |
| `web/src` | The client, plain TypeScript, no framework: `lib/` (DOM, signals, router), `game/` (questions, a run), `screens/` (one file per page), `ui.ts`, `app.css` |
| `web/DESIGN.md` | How it looks and speaks: tokens, components, copy rules. Follow it for any UI |
| `e2e` | The game in real browsers (Playwright) |
| `bank/sample` | A public sample of the questions; the real bank is private (`private/`, the `questions` skill) |
| `deploy` | The server's service and scripts (`deploy.sh` = `almanac-deploy`), played out against stubs in `deploy_test.go` |

Each Go package starts with a doc comment that says what it is and how it works: read it before changing the
package, and keep it true after.

## Run and check

```bash
go run ./cmd/build -watch & DEV=1 go run ./cmd/almanac serve   # http://localhost:8080, mail in the log
go vet ./... && go test ./...                                  # the server: under a minute
go test -race ./internal/<package>                             # the race detector, on a package you changed that runs things at once
npm run check && npm test                                      # the client: types, lint, unit tests, language
npx playwright test -c e2e --project=chromium e2e/<spec>       # the browser specs your change touches (`=`, or the spec reads as a project)
DEV=1 DB_PATH=/tmp/seeded.db go run ./cmd/almanac seed -state /tmp/personas   # weeks of play by many players (minutes); prints personas
```

A review or a look at a screen is of a game played for a while, not only of a new guest's empty pages: seed a new
database (then `serve` it with the same `DB_PATH`) and be its personas, a new guest to a long-time player (each one's `sid`
cookie, or `-state`'s Playwright storage state per persona).

CI runs the race detector on everything (`go test -race ./...`, several minutes, in a job no merge waits for);
locally run it where goroutines meet (`server`, or `play` when you touch its locks), not on everything: the SQLite driver is
Go, so under the detector every query is instrumented, and the whole tree takes minutes instead of seconds. A test gets
its database from `storetest.Open(t)` (migrated once per test program, copied) and the sample bank from
`banktest.Sample(t)` (shared: a test that changes questions loads its own with `bank.Load`).

Formatting is done for you: a hook (`.claude/hooks/format.sh`) runs gofmt or Biome on every file a session edits,
and stops a `git commit` with an unformatted file in it (`git add` them and commit again), or while Biome warns of
anything in the client: a warning fails CI as an error does, so fix it, never leave it.

Node (from `~/.nvm`) is on the shell's PATH already: don't `export PATH` in a command (a worktree-isolated agent is
refused git commands that do). Without Playwright's Chromium, the Chromium tests run in Brave by themselves
(`BROWSER_PATH` names another browser). Test what you change; a new rule or
screen gets a test. Look at a UI change at phone width (320–390 px) before shipping it.

## The game is in Bulgarian

Everything a player can see — screens, buttons, tiers, titles, achievements, mails, errors, notifications, questions
and facts — is in **standard literary Bulgarian**. Code, comments, commit messages, URLs and ids are in English.

- **Bulgarian words, not Russian ones.** Russian is close enough that its words pass unnoticed, so check every word
  you're not sure of in a Bulgarian dictionary ([РБЕ](https://ibl.bas.bg/rbe/),
  [rechnik.chitanka.info](https://rechnik.chitanka.info)), and when a word is only "also used", pick the plain,
  common Bulgarian one. Known slips: знаток → експерт or познавач; ответ → отговор; вопрос → въпрос; игрок → играч;
  уровень → ниво; сейчас → сега.
- **Bulgarian words, not loanwords.** A loanword stays only where Bulgarian has nothing else in common use („имейл“,
  „рейтинг“); otherwise the Bulgarian word: връзка, not линк; потребителско име, not таг; часовник, not таймер. Never
  borrowed slang.
- **Bulgarian letters only:** never ё, ы or э.
- **No Bulgarian in Latin letters**, anywhere: a route is `/daily`, never `/dnes`.
- **The house style** is in `web/DESIGN.md` (Copy): „ти“ to one player, short plain sentences, gender-neutral,
  numbers the Bulgarian way. Questions follow the `questions` skill.

`web/src/language.test.ts` (part of `npm test`) fails on a non-Bulgarian letter or a known Russian word in the
client, the server or the sample bank. It catches only what it knows: reading the words is still the check.

## Other rules

- **A mistake becomes a check.** When something goes wrong that another session could do again (a rule forgotten, a
  list kept in two places, a command that doesn't work), make it fail a test, a lint or a hook, in the same pull
  request; a sentence here is the last resort. That is how `TestAppPathsMatchTheClient`, `language.test.ts`, the
  format hook and the bank's lint came to be.
- **Free hand.** The game was rebuilt from zero in November 2026: no legacy to keep, nothing kept for compatibility.
  Rename completely (URLs, API, files, types, stored ids with a migration), delete what's unused.
- **The bank** (questions, facts) is changed only through the `questions` skill; a new batch is `/new-questions`; a fix by the rules (what `bank lint` lists) is `/fix-questions`.
- **Secrets** never go into the repo, a commit or a chat.

## Built to hold

What two independent reviews of the code (November 2026) kept finding. Where a check holds a rule, the check is
named; the rest is judgement, so weigh every change against it.

- **Abuse is cheap.** A limit by address counts the network and its site (`allowFrom`/`guardFrom`:
  `TestLimitsByAddressCountTheSite`), never a first-come global cap that a few networks fill to lock everyone out,
  and never so tight that a school, an office or a pub behind one address is refused. Ask of every new endpoint: what does it cost if
  one /48 calls it all day?
- **One player can hurt another.** Anything one player can send another is bounded: a push goes through `notifyFrom`
  (once a day from one player, a few a day in all), a name through the name checks and moderation in `/admin`. There
  is no blocking (DECISIONS.md): a request is declined, a friend removed.
- **Text from outside is untrusted everywhere:** names, reports, browser errors in logs, mails, alerts and the
  agents that fix questions (sanitised, never an instruction).
- **Time belongs to the run.** A run counts on the day it was dealt for, with one grace (`play.DayGrace`), never on
  "today" when its follow-up happens to run (`midnight_test.go`).
- **Background work is guarded and waited for:** every goroutine through `safe` (`TestGoroutinesGuarded`); a test
  waits for the game's background work before its database closes (`Game.Settled`).
- **Every table that names a player** is carried by a merge and cleared by a deletion
  (`TestMergeCoversTheSchema`, `TestPlayerColumnsRefer`); every column that refers to another table has its index
  (`TestForeignKeysIndexed`).
- **Privacy is what the page says:** nothing new about a player is kept or shown before `privacy.go` says so; logs
  carry route patterns, and an address only on a failure (`TestRequestLog`).
- **The owner's time is the scarcest thing.** No new recurring chore for the owner (a key to prove, a console to
  visit, a mail to read) without asking; a step only the owner can do is one short instruction, done with them.
- **Fixes bring flaws of their own.** After a wave of fixes or a big feature, a targeted independent review of just
  that change, before the next wave.

## Shipping: a merge is a deploy

Fast is the rule: several sessions work at once, and every wait multiplies across them.

- **A pull request waits only for the fast checks** (Server, Client, PR title: a few minutes). Open it and queue
  the merge in one go — `gh pr merge <n> --auto --squash` — then move on: GitHub merges it when they pass. Don't
  watch CI, and don't merge `main` into a branch unless GitHub says it conflicts. One thing blocks a merge with
  every check green: a CodeQL alert of severity *error* (`go/log-injection`, `go/allocation-size-overflow`, even at
  a "medium" security level). After the checks, `gh api "repos/almanac-bg/almanac/code-scanning/alerts?pr=<n>&state=open"`;
  fix what it lists in code, never by dismissing it.
- **A PR's title is plain English** saying what changed; it becomes the commit on main and the release notes' line.
  No format to follow: nothing reads one.
- **Merging to `main` releases and deploys by itself** (`.github/workflows/deploy.yml`), and nobody decides it: a
  merge that changes the program (its build's hash differs from the last release's) is released, once main as merged
  passes the server's and the client's checks, one that doesn't (tests, docs, tooling) isn't. The version counts up its minor when the release brings a new migration, its patch
  otherwise: one minor, one schema. A major is the owner's call only (the workflow run by hand). `almanac-deploy` restarts the server at
  once: every game is in the database, answer by answer, so a restart cuts no play. Connections wait in systemd's socket through the restart; a version that brings a migration copies the database before it, and the deploy goes back by itself,
  program and database copy both, if it isn't healthy. A release that can't load the bank the game plays (an older one
  than a field or a rule the bank has taken since; a newer one whose load, the format and what a game depends on, the
  live bank fails: CI tests only the sample) isn't deployed, and nothing restarts: never expect to go back below the
  bank. The bank's editorial rules (`bank lint`) are `bank check`'s alone, never the server's load: a stricter rule
  never holds a release, it holds the next bank update (`almanac-bank`) until the bank or the rule is fixed, so try it
  on the private bank before merging it anyway. Every run deploys the latest release if it isn't live, so a
  failed deploy is tried again by the next merge; one that went back isn't, nor (if it never came up after it began
  to migrate) a release that brings that migration unchanged: change what failed. No tags by hand, no ssh to deploy. A change to `deploy/` reaches the
  server only by hand, as root, the way `deploy/setup.sh` installs it (then `systemctl daemon-reload` for a unit; a
  changed firewall or sshd file goes back by itself in ten minutes unless `almanac-harden confirm` comes from a new
  ssh login: `deploy/harden.sh`); until then the Deploy run is red. Nothing a player does may live in the server's memory
  alone: anything new kept there must survive a restart (the limits' counts do: `limits.go`).
- **The browser tests run after the merge, on `main`** (all three engines, each in shards side by
  side). They hold nothing up; if one fails, whoever sees it fixes it, at once (a session is told as it starts:
  `.claude/hooks/main-red.sh`).
  Before opening a PR, run only the specs your change touches, in Chromium:
  `npx playwright test -c e2e --project=chromium e2e/<spec>`. Each checkout gets its own port, so sessions
  don't stop each other's test servers.
- **A migration is a new file in `internal/store/migrations`,** named `NNNN_what.sql` with the next number you see.
  The database keeps the names of the migrations it has had, so if another session lands one with the same number,
  both still run once. Write a migration so it doesn't depend on another one being unmerged, nor on landing before
  one that isn't merged yet: production applies a late one (named before one it has run) late. What a migration
  drops on purpose (a table, a column, an index, a trigger) it names in a line `-- drops: runs.foo, runs_board`, or it
  fails; so a rebuild (`-- rebuild`) copies every column its table has and makes its indexes again. As a release
  starts, before it copies or migrates anything, it tries the migrations still to apply on a copy of the live schema,
  and refuses to start (the deploy goes back by itself, the database as it was) unless the schema comes out as a new
  database's (`store.CheckShape`): a late one refused never ran, so change it, or give it a number after the latest.
  Never edit (but its comments) or renumber one that may have run in production: a change is a new migration.

## Leave the machine as you found it

This runs on the owner's own Mac, with other sessions beside you. When your work is done (and before you say so):

- **Stop what you started:** dev servers (`almanac serve`), `-watch` builds, background commands, anything left on a
  port. Playwright closes its browsers and its test server by itself; a browser or script you opened yourself, close.
- **Remove what you made:** temporary worktrees (`git worktree remove`), test databases and `test-results/`,
  screenshots, scripts and files in the scratchpad or `/tmp`, temporary config copies.
  Merged branches and finished worktrees left behind anyway are cleared as sessions start (`.claude/hooks/tidy.sh`,
  logged in `.git/tidy.log`).
- **Never touch another session's** worktree, branch, server or files: check that a process or port is yours
  (its folder) before stopping it.
- Check with `ps`, `lsof -iTCP -sTCP:LISTEN` and `git status` that nothing of yours is left.

## Production

One Hetzner server (ARM) behind Cloudflare; the program runs under systemd as `almanac`, serves HTTPS itself, keeps
SQLite in `/var/lib/almanac`, and backs it up to R2 (README, „Резервни копия“). Deploys come from CI (above). By hand, as root:
`almanac-deploy vX.Y.Z` (also how to go back: an older version, within the same minor (`vX.Y.*`: the same migrations); to an older minor only by
the steps below, as the older version refuses the migrated database; a release is taken only signed, so
one from before signatures only while it's kept in `/usr/local/lib/almanac`, the five used latest), `almanac-bank` (check the new
questions apart, then pull and reload them), `journalctl -u almanac` (logs). A bank reload and a deploy never run at
once (they share a lock: `TestDeployAndBankShareALock`). The `almanac backup` commands need the service's settings:
`systemd-run --pipe --wait --collect -p User=almanac -p EnvironmentFile=/etc/almanac/env /usr/local/bin/almanac backup verify`
brings the latest copy back and checks it (the server does this itself daily). Health: `https://almanac.bg/api/health`
shows the live version and the bank played (its commit; one refused). A new server, and what is set up outside the
code (Cloudflare, mail, where each secret is kept): README, „Нов сървър и каквото е извън кода“.

Going back to an older minor (vOLD) from the version live now (vNEW) puts the database back as it was before the
migration: by hand, as root, in this order and no other. A copy put in beside the database's `-wal` comes out corrupt
while health says `ok`, and the newer program, started on the copy, migrates it again.

0. It loses every game played since that release: fix forward instead, unless the migration destroyed data.
1. Before stopping anything, the older program reads the live bank, or there is no going back below the bank (it
   says „the server would not play this bank“: fix forward):

   ```bash
   setpriv --reuid=almanac --regid=almanac --clear-groups /usr/local/lib/almanac/almanac-vOLD bank check /srv/almanac-bank
   ```
2. Mark vNEW as deploy.sh marks a release that failed migrating: CI then deploys neither it nor any release that
   brings its migrations unchanged (else the next merge puts it back, and it migrates the copy again). It prints the
   mark: a line why, and a `migration <sha>  <name>` line for each migration vNEW has and vOLD hasn't; or, marking
   nothing, why to stop. Stopping after it, before step 5 (a step fails, or you fix forward), take the mark away, or
   with vNEW live nothing does, and CI refuses its migrations for good: `rm /var/lib/almanac-deploy/unhealthy-vNEW`.

   ```bash
   v() { setpriv --reuid=almanac --regid=almanac --clear-groups /usr/local/lib/almanac/almanac-$1 migrations; }
   mark=/var/lib/almanac-deploy/unhealthy-vNEW
   if ! v vOLD >/run/had || [ ! -s /run/had ]; then echo "stop: vOLD can't list its migrations"
   elif ! v vNEW >/run/has; then echo "stop: vNEW lists no migrations"
   elif ! grep -vxFf /run/had /run/has >/run/new; then echo "stop: no migration between: almanac-deploy vOLD"
   else mkdir -p "${mark%/*}" && { echo "vNEW went back by hand at $(date -u '+%Y-%m-%d %H:%M UTC'): WHY"
     sed 's/^/migration /' /run/new; } >"$mark" && cat "$mark"; fi; rm -f /run/had /run/has /run/new
   ```
3. `systemctl stop almanac.socket almanac`.
4. The database aside with its log, the copy in its place (`before-vX.Y.Z.db` of the first release after vOLD that
   brought a migration; the two latest are kept, older ones are in the backups), and vOLD linked: a failed step 5 then
   has nothing to go back to (deploy.sh goes back to the version linked, and vNEW would migrate the copy again):

   ```bash
   cd /var/lib/almanac && ls before-vX.Y.Z.db && f=failed-by-hand-$(date -u +%Y%m%dT%H%M%SZ).db &&
     mv almanac.db "$f" && { [ ! -e almanac.db-wal ] || mv almanac.db-wal "$f-wal"; } && rm -f almanac.db-shm &&
     mv before-vX.Y.Z.db almanac.db && ln -sfn /usr/local/lib/almanac/almanac-vOLD /usr/local/bin/almanac
   ```
5. `almanac-deploy vOLD`: it starts the older program on the copy. Never start the socket or the service before it,
   nor ever while vNEW is linked over the copy. If it fails before the restart („not taken“, „not deployed“), nothing
   started: fix that, run it again. If vOLD started and isn't healthy („nothing to go back to“), `systemctl stop
   almanac.socket almanac`; then fix it and `systemctl start almanac.socket almanac`, or go back up: step 4 the other
   way (the copy aside with its `-wal`, `failed-by-hand-….db` and its `-wal` back as `almanac.db`), then
   `almanac-deploy vNEW` (by hand it goes out marked, and its mark goes once it's healthy).
6. The fix goes forward, in a new release: CI refuses every one that brings any marked migration unchanged
   (`TestBackBelowAMigrationByHand`), so it changes each of them (from a vOLD several migrating releases back, the
   mark has them all) or goes out by hand; the mark goes once a release that has run them all is live and healthy.
