# АЛМАНАХ

A quiz game for Bulgarian players, live at [almanac.bg](https://almanac.bg). It's built almost entirely by AI
sessions, several at once: the owner gives a purpose ("duels should be live", "points should feel bigger"), and the
session designs it, builds it, tests it and ships it, all the way to production, without asking for go-aheads it
doesn't need. Decide; say why in a line; act. Ask only when the answer changes the product in a way the owner would
want to choose.

This file is the way in. Read it first; it says where everything else is. `DECISIONS.md` holds the owner's calls and
their reasons: read it before changing what a player sees or how the game plays, and don't undo one on your own.

## The game, in a paragraph

Ten questions a day, the same for everyone (Начало); games by topic that follow what a player knows; live duels with
whoever comes (a recording of a real game if nobody does) and friends challenged in their own time (anyone, by a challenge's link: `play/challenges.go`); Роял at 21:00
Friday to Sunday (every evening once those fill), up to 50 live on 15 questions, cut by right answers after the 5th, 8th, 11th and 14th; rooms with a code for playing together; friends,
levels (XP), achievements, titles, avatars, a rating with divisions, and weekly leagues. Points are a game's score,
XP is what playing earns, rating is strength: kept apart on purpose (`internal/play/worth.go`), and joined in one
system of progress (`internal/play/progress.go` says how: what earns XP, what unlocks what, what's told when), which a
new player meets a part at a time, as each starts to matter (`internal/play/unfold.go`).

## Direction

The day's ten questions are the heart of the game: the habit a player comes back for, the result they share. Everything
else serves it or stays out of its way. The game already has many systems; a new one must replace something or prove
it's needed, and quiet beats loud (a new player sees the day and the topics first, a game's news is three cards at
most). A change is judged by whether players come back: the retention numbers in `/admin`.

## Where things are

| Path | What |
| --- | --- |
| `cmd/almanac` | The program: `serve`, `bank check/fmt`, `backup now/restore/verify` |
| `cmd/build` | Builds the client into `internal/assets/dist` (esbuild; a size ceiling against accidents) |
| `internal/play` | The game's rules and data: runs, scoring (`worth.go`), duels, friends, rating, leagues, goals, progress |
| `internal/live` | Live duels: matchmaking, the shared clock, recordings |
| `internal/royal` | Роял, live in the evening (Friday to Sunday until the evenings fill) |
| `internal/room` | Rooms with a code |
| `internal/server` | HTTP: the API (`api.go` maps errors to Bulgarian messages), routes (`server.go`), pages (`pages.go`: the paths it sends the app for, the client's router's list again; a test holds them equal) |
| `internal/store` | SQLite; migrations in `internal/store/migrations`, applied once each by name |
| `internal/bank` | Question types, the bank on disk, its checks |
| `internal/account`, `mail`, `push`, `backup`, `qr` | Players and sign-in, email, Web Push, hourly backups to R2 (each checked before it's sent, one brought back daily), QR codes |
| `web/src` | The client, plain TypeScript, no framework: `lib/` (DOM, signals, router), `game/` (questions, a run), `screens/` (one file per page), `ui.ts`, `app.css` |
| `web/DESIGN.md` | How it looks and speaks: tokens, components, copy rules. Follow it for any UI |
| `e2e` | The game in real browsers (Playwright) |
| `bank/sample` | A public sample of the questions; the real bank is private (`private/`, the `questions` skill) |
| `deploy` | The server's service and scripts (`deploy.sh` = `almanac-deploy`) |
| `mobile` | The app for iPhone and Android: the site in the phone's web view (Capacitor), with notifications; `mobile/README.md` |

Each Go package starts with a doc comment that says what it is and how it works: read it before changing the
package, and keep it true after.

## Run and check

```bash
go run ./cmd/build -watch & DEV=1 go run ./cmd/almanac serve   # http://localhost:8080, mail in the log
go vet ./... && go test ./...                                  # the server: about 15 seconds
go test -race ./internal/<package>                             # the race detector, on a package you changed that runs things at once
npm run check && npm test                                      # the client: types, lint, unit tests, language
npx playwright test -c e2e --project=chromium e2e/<spec>       # the browser specs your change touches (`=`, or the spec reads as a project)
```

CI runs the race detector on everything (`go test -race ./...`, a minute or two); locally run it where goroutines
meet (`live`, `room`, `royal`, `server`, or `play` when you touch its locks), not on everything: the SQLite driver is
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

## Shipping: a merge is a deploy

Fast is the rule: several sessions work at once, and every wait multiplies across them.

- **A pull request waits only for the fast checks** (Server, Client, PR title: two minutes or so). Open it and queue
  the merge in one go — `gh pr merge <n> --auto --squash` — then move on: GitHub merges it when they pass. Don't
  watch CI, and don't merge `main` into a branch unless GitHub says it conflicts.
- **Merging to `main` releases and deploys by itself** (`.github/workflows/deploy.yml`): the version comes from the
  commit titles (feat → minor, fix/perf/revert → patch, `!` → major). `almanac-deploy` restarts the server only when
  that cuts no play: it drains it first (no new live duel or room game; those under way finish, five minutes at the
  most), and waits out Роял (from 20:39 to the end of its games), so a deploy may take a while to go live, and
  several merges meanwhile go out as one. Connections wait in systemd's socket through the restart; rooms are kept
  over it; the new version copies the database before its migrations, and the deploy goes back by itself, program
  and database copy both, if it isn't healthy. No tags by hand, no ssh to deploy. Anything new kept in memory must
  survive a restart or count as under way (`internal/server/drain.go`).
- **The browser tests run after the merge, on `main`** (about 15 minutes, all three engines). They hold nothing up;
  if one fails, whoever sees it fixes it, at once (a session is told as it starts: `.claude/hooks/main-red.sh`).
  Before opening a PR, run only the specs your change touches, in Chromium:
  `npx playwright test -c e2e --project=chromium e2e/<spec>`. Each checkout gets its own port, so sessions
  don't stop each other's test servers.
- **A migration is a new file in `internal/store/migrations`,** named `NNNN_what.sql` with the next number you see.
  The database keeps the names of the migrations it has had, so if another session lands one with the same number,
  both still run once: never renumber. Write a migration so it doesn't depend on another one being unmerged.

## Leave the machine as you found it

This runs on the owner's own Mac, with other sessions beside you. When your work is done (and before you say so):

- **Stop what you started:** dev servers (`almanac serve`), `-watch` builds, background commands, anything left on a
  port. Playwright closes its browsers and its test server by itself; a browser or script you opened yourself, close.
- **Remove what you made:** temporary worktrees (`git worktree remove`), test databases and `test-results/`,
  screenshots, scripts and files in the scratchpad or `/tmp`, temporary config copies.
- **Never touch another session's** worktree, branch, server or files: check that a process or port is yours
  (its folder) before stopping it.
- Check with `ps`, `lsof -iTCP -sTCP:LISTEN` and `git status` that nothing of yours is left.

## Production

One Hetzner server (ARM) behind Cloudflare; the program runs under systemd as `almanac`, serves HTTPS itself, keeps
SQLite in `/var/lib/almanac`, and backs it up hourly to R2. Deploys come from CI (above). By hand, as root:
`almanac-deploy vX.Y.Z` (also how to go back: an older version, with `now` after it to skip the wait for play to
end, as long as no migration came since; past one, the older version refuses the database and the deploy goes back
to where it was, so put the copy from before that release back by hand, `/var/lib/almanac/before-vX.Y.Z.db`, with
`systemctl stop almanac.socket almanac` first, and lose what was played since), `almanac-bank` (pull and reload the
questions), `journalctl -u almanac` (logs). The `almanac backup` commands need the service's settings:
`systemd-run --pipe --wait -p User=almanac -p EnvironmentFile=/etc/almanac/env /usr/local/bin/almanac backup verify`
brings the latest copy back and checks it (the server does this itself daily). Health: `https://almanac.bg/api/health`
shows the live version.
