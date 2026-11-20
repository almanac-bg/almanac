# АЛМАНАХ

A quiz game for Bulgarian players, live at [almanac.bg](https://almanac.bg). It's built almost entirely by AI
sessions, several at once: the owner gives a purpose ("duels should be live", "points should feel bigger"), and the
session designs it, builds it, tests it and ships it, all the way to production, without asking for go-aheads it
doesn't need. Decide; say why in a line; act. Ask only when the answer changes the product in a way the owner would
want to choose.

This file is the way in. Read it first; it says where everything else is. `DECISIONS.md` holds the owner's calls and
their reasons: read it before changing what a player sees or how the game plays, and don't undo one on your own.

## The game, in a paragraph

Every day ten questions; each one a player gets right in the issue writes its fact in ink in their Алманах, and their
rank in a chapter says how much of it the book holds in ink; played alone, with friends, beside all of Bulgaria. Three
places: Днес (the day's issue, the same ten for everyone, asked once, its result shared without the answers), Алманах
(the player's book: a chapter per topic, ink from the issues, every other fact met in grey, a seal per chapter named
for the book), Приятели (friends, the day's board, duels on one's own time against a friend or a real
recorded game). The streak is the habit and forgives two missed days a week. The score is the number right; nothing
else adds up but ink and the streak. DECISIONS.md, „The direction“, is final: it lists the player's nouns and the rule
every later change passes.

**Being built (from 20 Nov 2026).** Until each part lands the code still has points, visible mastery, the book's notes
and „the edition“ look; don't extend them.

## Direction

The day's ten questions are the heart of the game: the habit a player comes back for. Everything
else serves it or stays out of its way. The game already has many systems; a new one must replace something or prove
it's needed, and quiet beats loud (a new player sees the day and the topics first, a game's news is three cards at
most). A change is judged by whether players come back: the retention numbers in `/admin`.

## Where things are

| Path | What |
| --- | --- |
| `cmd/almanac` | The program: `serve`, `bank check/fmt`, `backup now/list/restore/verify/keys` |
| `cmd/build` | Builds the client into `internal/assets/dist` (esbuild; precompressed; the first screen's budget, and ceilings against accidents) |
| `internal/play` | The game's rules and data: runs, scoring (`worth.go`), the streak (`runs.go`), the Алманах and its notes (`progress.go`), duels on one's own time (`duels.go`: a friend's, a recording's), friends |
| `internal/server` | HTTP: the API (`api.go` maps errors to Bulgarian messages), routes (`server.go`), pages (`pages.go`: the paths it sends the app for, the client's router's list again; a test holds them equal) |
| `internal/store` | SQLite; migrations in `internal/store/migrations`, applied once each by name |
| `internal/bank` | Question types, the bank on disk, its checks |
| `internal/card` | The picture a shared day's link shows (1200 × 630 PNG), drawn in Go with the game's fonts (static cuts made by `web/src/fonts/subset.sh`) |
| `internal/account`, `mail`, `push`, `backup` | Players and sign-in, email, Web Push, backups to R2 every 15 minutes (each checked before it's sent, encrypted to a key kept off the server, one brought back daily, the owner's key proven monthly: `backup proven`) |
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
go vet ./... && go test ./...                                  # the server: about 15 seconds
go test -race ./internal/<package>                             # the race detector, on a package you changed that runs things at once
npm run check && npm test                                      # the client: types, lint, unit tests, language
npx playwright test -c e2e --project=chromium e2e/<spec>       # the browser specs your change touches (`=`, or the spec reads as a project)
DEV=1 DB_PATH=/tmp/seeded.db go run ./cmd/almanac seed -state /tmp/personas   # 60 days of 200 players (minutes); prints personas
```

A review or a look at a screen is of a game played for a while, not only of a new guest's empty pages: seed a new
database (then `serve` it with the same `DB_PATH`) and be its personas, a new guest to a long-time player (each one's `sid`
cookie, or `-state`'s Playwright storage state per persona).

CI runs the race detector on everything (`go test -race ./...`, a minute or two); locally run it where goroutines
meet (`server`, or `play` when you touch its locks), not on everything: the SQLite driver is
Go, so under the detector every query is instrumented, and the whole tree takes minutes instead of seconds. A test gets
its database from `storetest.Open(t)` (migrated once per test program, copied) and the sample bank from
`banktest.Sample(t)` (shared: a test that changes questions loads its own with `bank.Load`).

Formatting is done for you: a hook (`.claude/hooks/format.sh`) runs gofmt or Biome on every file a session edits,
and stops a `git commit` with an unformatted file in it (`git add` them and commit again).

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

What two independent reviews (November 2026, `../review-2026-11-17/`, `../review-2026-11-18/`) kept finding. Where a
check holds a rule, the check is named; the rest is judgement, so weigh every change against it.

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

- **A pull request waits only for the fast checks** (Server, Client, PR title: two minutes or so). Open it and queue
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
  program and database copy both, if it isn't healthy. Every run deploys the latest release if it isn't live, so a
  failed deploy is tried again by the next merge; one that went back isn't, nor (if it never came up after it began
  to migrate) a release that brings that migration unchanged: change what failed. No tags by hand, no ssh to deploy. A change to `deploy/` reaches the
  server only by hand, as root, the way `deploy/setup.sh` installs it (then `systemctl daemon-reload` for a unit; a
  changed firewall or sshd file goes back by itself in ten minutes unless `almanac-harden confirm` comes from a new
  ssh login: `deploy/harden.sh`); until then the Deploy run is red. Nothing a player does may live in the server's memory
  alone: anything new kept there must survive a restart (the limits' counts do: `limits.go`).
- **The browser tests run after the merge, on `main`** (about 15 minutes, all three engines). They hold nothing up;
  if one fails, whoever sees it fixes it, at once (a session is told as it starts: `.claude/hooks/main-red.sh`).
  Before opening a PR, run only the specs your change touches, in Chromium:
  `npx playwright test -c e2e --project=chromium e2e/<spec>`. Each checkout gets its own port, so sessions
  don't stop each other's test servers.
- **A migration is a new file in `internal/store/migrations`,** named `NNNN_what.sql` with the next number you see.
  The database keeps the names of the migrations it has had, so if another session lands one with the same number,
  both still run once. Write a migration so it doesn't depend on another one being unmerged, nor on landing before
  one that isn't merged yet: production applies a late one (named before one it has run) late. What a migration
  drops on purpose (a table, a column, an index, a trigger) it names in a line `-- drops: runs.foo, runs_board`, or it
  fails; so a rebuild (`-- rebuild`) copies every column its table has and makes its indexes again. Before applying a
  late migration, the program tries it on a copy of the schema, and refuses to start (the deploy goes back by itself)
  unless the schema comes out as a new database's: then the late migration never ran, so change it, or give it a
  number after the latest. Never renumber one that may have run in production.

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
SQLite in `/var/lib/almanac`, and backs it up to R2 every 15 minutes. Deploys come from CI (above). By hand, as root:
`almanac-deploy vX.Y.Z` (also how to go back: an older version, within the same minor (`vX.Y.*`: the same migrations); to an older minor, the older version refuses the database and the deploy goes back
to where it was, so put the copy from before that release back by hand, `/var/lib/almanac/before-vX.Y.Z.db`, with
`systemctl stop almanac.socket almanac` first, and lose what was played since; a release is taken only signed, so
one from before signatures only while it's kept in `/usr/local/lib/almanac`, the five used latest), `almanac-bank` (check the new
questions apart, then pull and reload them), `journalctl -u almanac` (logs). The `almanac backup` commands need the service's settings:
`systemd-run --pipe --wait -p User=almanac -p EnvironmentFile=/etc/almanac/env /usr/local/bin/almanac backup verify`
brings the latest copy back and checks it (the server does this itself daily). Health: `https://almanac.bg/api/health`
shows the live version and the bank played (its commit; one refused).
