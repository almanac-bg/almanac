# АЛМАНАХ

A quiz game for Bulgarian players, live at [almanac.bg](https://almanac.bg). It's built almost entirely by AI
sessions, several at once: the owner gives a purpose ("duels should be live", "points should feel bigger"), and the
session designs it, builds it, tests it and ships it, all the way to production, without asking for go-aheads it
doesn't need. Decide; say why in a line; act. Ask only when the answer changes the product in a way the owner would
want to choose.

This file is the way in. Read it first; it says where everything else is.

## The game, in a paragraph

Ten questions a day, the same for everyone (Начало); games by topic that follow what a player knows; live duels with
whoever comes (a recording of a real game if nobody does) and friends challenged in their own time; Роял every
evening at 21:00, up to 50 live, out at the first wrong answer; rooms with a code for playing together; friends,
levels (XP), achievements, titles, avatars, a rating with divisions and monthly seasons. Points are a game's score,
XP is what playing earns, rating is strength: kept apart on purpose (`internal/play/worth.go`).

## Where things are

| Path | What |
| --- | --- |
| `cmd/almanac` | The program: `serve`, `bank check/fmt`, `backup now/restore` |
| `cmd/build` | Builds the client into `internal/assets/dist` (esbuild; size budgets) |
| `internal/play` | The game's rules and data: runs, scoring (`worth.go`), duels, friends, rating, seasons, goals, progress |
| `internal/live` | Live duels: matchmaking, the shared clock, recordings |
| `internal/royal` | Роял, live every evening |
| `internal/room` | Rooms with a code |
| `internal/server` | HTTP: the API (`api.go` maps errors to Bulgarian messages), routes (`server.go`), pages (`pages.go`: every client route must be listed there, or a reload is a 404) |
| `internal/store` | SQLite; migrations in `internal/store/migrations`, applied once each by name |
| `internal/bank` | Question types, the bank on disk, its checks |
| `internal/account`, `mail`, `push`, `backup` | Players and sign-in, email, Web Push, hourly backups to R2 |
| `web/src` | The client, plain TypeScript, no framework: `lib/` (DOM, signals, router), `game/` (questions, a run), `screens/` (one file per page), `ui.ts`, `app.css` |
| `web/DESIGN.md` | How it looks and speaks: tokens, components, copy rules. Follow it for any UI |
| `e2e` | The game in real browsers (Playwright) |
| `bank/sample` | A public sample of the questions; the real bank is private (`private/`, the `questions` skill) |
| `deploy` | The server's service and scripts (`deploy.sh` = `almanac-deploy`) |

Each Go package starts with a doc comment that says what it is and how it works: read it before changing the
package, and keep it true after.

## Run and check

```bash
go run ./cmd/build -watch & DEV=1 go run ./cmd/almanac serve   # http://localhost:8080, mail in the log
go vet ./... && go test -race ./...                            # the server
npm run check && npm test                                      # the client: types, lint, unit tests, language
npx playwright test -c e2e --project chromium e2e/<spec>       # the browser specs your change touches
```

Formatting is done for you: a hook (`.claude/hooks/format.sh`) runs gofmt or Biome on every file a session edits,
and stops a `git commit` with an unformatted file in it (`git add` them and commit again).

Node lives under `~/.nvm` (put its `bin` on PATH in tool shells). Locally, Playwright's Chromium may be missing:
`BROWSER_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"`. Test what you change; a new rule or
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

- **Free hand.** The game was rebuilt from zero in November 2026: no legacy to keep, nothing kept for compatibility.
  Rename completely (URLs, API, files, types, stored ids with a migration), delete what's unused.
- **The bank** (questions, facts) is changed only through the `questions` skill.
- **Secrets** never go into the repo, a commit or a chat.

## Shipping: a merge is a deploy

Fast is the rule: several sessions work at once, and every wait multiplies across them.

- **A pull request waits only for the fast checks** (Server, Client, PR title: about a minute). Open it and queue
  the merge in one go — `gh pr merge <n> --auto --squash` — then move on: GitHub merges it when they pass. Don't
  watch CI, and don't merge `main` into a branch unless GitHub says it conflicts.
- **Merging to `main` releases and deploys by itself** (`.github/workflows/deploy.yml`): the version comes from the
  commit titles (feat → minor, fix/perf/revert → patch, `!` → major), and `almanac-deploy` copies the database before
  it starts the new version, then goes back by itself if it isn't healthy. No tags by hand, no ssh to deploy.
- **The browser tests run after the merge, on `main`** (about 15 minutes, all three engines). They hold nothing up;
  if one fails, fix it with the next change. Before opening a PR, run only the specs your change touches, in
  Chromium: `npx playwright test -c e2e --project chromium e2e/<spec>`. Each checkout gets its own port, so sessions
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
`almanac-deploy vX.Y.Z` (also how to go back: an older version), `almanac-bank` (pull and reload the questions),
`journalctl -u almanac` (logs). Health: `https://almanac.bg/api/health` shows the live version.
