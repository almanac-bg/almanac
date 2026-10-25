# АЛМАНАХ ⚡ — almanac.bg

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Play](https://img.shields.io/badge/play-almanac.bg-8b5cf6.svg)](https://almanac.bg)

Real-time multiplayer quiz battles, in Bulgarian: play at **[almanac.bg](https://almanac.bg)**. This is its complete
source code, free software under the [AGPL-3.0](LICENSE).

![АЛМАНАХ](apps/web/public/og.jpg)

It has:

- **Modes:** solo practice, a daily challenge, ranked 1v1 duels and 2v2 teams, 3- and 5-player free-for-alls, an
  8-player Royale with eliminations, private rooms for friends, and challenge links anyone can play.
- **Progression:** accounts level up, unlock cosmetics and jokers, earn achievements, finish daily quests, keep a
  daily streak (with shields), climb monthly seasons and keep detailed statistics.
- **Social:** players can add friends, invite and challenge each other, ask for a rematch, and submit their own
  questions for review. Visitors can play straight away as guests and save their progress later.

## Quick start

Requires Node 24+. It uses the built-in `node:sqlite`, so there's no database to install.

```bash
npm install
npm run dev
```

Open http://localhost:5173, register an account, and play. In development **the first account you register becomes
the admin**, so it can approve community questions. In production nobody becomes an admin by signing up; see
step 5 of [Deploying](#deploying-any-vps--docker).

The game's real question bank (about 2,000 questions) isn't part of the public code, so answers can't be looked up
during a match. A checkout without it plays the 120-question sample in `apps/server/src/data/questions.sample.json`,
which is enough to develop with and to run every test. See [Questions](#adding-questions).

When no other humans are queuing, bots fill the empty seats after a few seconds, so every mode is playable alone. To
test real multiplayer locally, open a second browser (or a private window) with another account.

| Script              | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `npm run dev`       | API + realtime server on :3001 and Vite on :5173 (proxied)           |
| `npm run build`     | Builds the web app and bundles the server into `apps/server/dist`    |
| `npm start`         | Production server on :3001 (plain Node) that also serves the web app |
| `npm run typecheck` | Type-checks every package                                            |
| `npm test`          | Full test suite (~45 s), see below                                   |

### Tests

`npm test` runs these suites with Node's built-in test runner:
- **`e2e.test.ts`** boots a real server with a throwaway database and plays through everything with real sockets.
  Two players and bots cover: solo, a ranked duel with a reconnect, Royale eliminations, private rooms and teams,
  the daily challenge, friends, invites and challenges, every joker, community questions with moderation, season
  rewards, flagging and hiding wrong questions, guests, challenge links, rematches, streak-reminder opt-out, results
  replayed after a dropped connection, malformed socket
  messages (which must never crash the server), and how the website's files are cached.
- **`game.test.ts`** drives the match engine on a mocked clock: leaving and forfeits, dropped connections, abandoned
  matches, "Двойно или нищо", tie-breaks and bot strength.
- **`restart.test.ts`** covers graceful restarts (running matches finish first) and a daily attempt cut short by a crash.
- **`database.test.ts`** checks the per-player question history and that hot queries use indexes.
- **`production.test.ts`** runs the server as in production: admins only through the admin command line, browser security
  headers, the health check, crash reports.
- **`maintenance.test.ts`** covers the cleanup of expired logins and the daily database snapshots.
- **`progress.test.ts`** covers daily quests, streak shields, the evening streak reminder, guest cleanup and the launch
  statistics.
- **`monitoring.test.ts`** checks the error reports sent to Sentry, their rate limit, and that the browser tunnel
  only forwards to the site's own project.
- **`questions.test.ts`** validates the question bank. New questions must pass it.
- **`rules.test.ts`** checks the scoring and progression rules, including Sofia-time day and season boundaries across
  DST changes.

`npm run test:dist -w @quiz/server` runs the same suites against the production bundle. GitHub Actions
(`.github/workflows/ci.yml`) runs typecheck, build and both test targets on every push, then builds the Docker image
and checks that it boots.

### Configuration (environment variables)

| Variable           | Default                               | Meaning                                                      |
| ------------------ | ------------------------------------- | ------------------------------------------------------------ |
| `PORT`             | `3001`                                | Server port                                                  |
| `DB_PATH`          | `apps/server/data/quiz.db`            | SQLite file (created and migrated automatically)             |
| `BOT_FILL_SECONDS` | `8`                                   | Queue wait before bots fill empty seats; `off` disables bots |
| `PUBLIC_QUEUES`    | `duel,royale`                         | Ranked queues players can join (`all`, or a list of `duel`, `teams`, `trio`, `squad`, `royale`) |
| `COOKIE_SECURE`    | `false`                               | Set `true` when served over HTTPS                            |
| `TRUST_PROXY`      | `loopback`                            | Express `trust proxy`; which reverse proxies to trust        |
| `APP_URL`          | `http://localhost:5173`               | Public origin used in email links                            |
| `SMTP_URL`         |                                       | e.g. `smtp://user:pass@host:587`. Unset → emails are printed to the console |
| `MAIL_FROM`        | `АЛМАНАХ <no-reply@almanac.bg>`       | Sender address                                               |
| `GAME_TIME_SCALE`  | `1`                                   | Multiplies all in-game timers. For automated tests only      |
| `BACKUP_DIR`       | `backups` next to the database        | Daily database snapshots; `off` disables them                |
| `BACKUP_KEEP_DAYS` | `14`                                  | How many daily snapshots to keep                             |
| `DRAIN_SECONDS`    | `330` in production, `0` otherwise    | On shutdown, how long running matches may finish first       |
| `SENTRY_DSN`       |                                       | Sentry project for error reports; unset → errors only go to the log |
| `APP_RELEASE`      |                                       | Version tag on error reports (the deploy command sets the git commit) |

| `OPERATOR_NAME`, `OPERATOR_ADDRESS` |                      | Who runs the site, shown in the privacy policy and terms (required) |
| `CONTACT_EMAIL`    | `privacy@<domain>`                    | Contact address in the legal pages and emails                |
| `EMAIL_PROVIDER`, `HOSTING_PROVIDER` |                    | Named in the privacy policy as processors                    |
| `SOURCE_URL`       |                                       | Public repository, linked in the footer ("Изходен код")      |
| `QUESTIONS_PATH`   | `private/questions.json`, else the sample | The built-in question bank (see [Adding questions](#adding-questions)) |

The brand name lives in `packages/shared/src/brand.ts`.

## Layout

```
packages/shared   Rules & catalog shared by client and server: modes, level curve, seasons,
                  cosmetics, jokers, achievements, socket and REST types
apps/server       Express + Socket.IO + SQLite
  src/game/Game.ts        Server-authoritative match engine (timers, scoring, teams, jokers, eliminations, bots)
  src/game/matchmaking.ts Quick-match queues with bot fill and team balancing
  src/game/rooms.ts       Private rooms (5-digit codes, /join/12345 links, teams, friend invites)
  src/game/rewards.ts     Persists matches: XP, stats, seasonal Elo, daily results, achievements
  src/seasons.ts          Monthly seasons: soft reset, season-end rewards (settled lazily)
  src/daily.ts            Daily challenge: one seeded question set per day, one attempt
  src/friends.ts          Friend requests and presence
  src/submissions.ts      Community questions and moderation
  src/data/questions.sample.json  Public sample of the question bank (the real one is private, in private/)
packages/client   Client core: API calls, realtime game state (zustand), formatting. The website
                  plugs in its sounds; kept separate so other clients can reuse it
apps/web          React 19 + Vite + Tailwind 4 + Motion
```

## How it plays

- **Modes:**
  - Соло: 10 questions, pick a category.
  - Дневно предизвикателство: the same 10 questions for everyone (each player gets their own option order), one
    attempt a day, no jokers, its own leaderboard. An attempt cut short by a server restart can be replayed.
  - Дуел: 1v1.
  - Отбори: 2v2, with teams balanced by rating.
  - Трио: 3 players.
  - Арена: 5 players.
  - Роял: 8 players. The lowest scorer is knocked out after questions 3, 5, 7, 9, 11 and 13.
  - Предизвикателство (challenge link, `/c/<id>`): a player makes a link with 10 fixed questions and plays it first;
    anyone with the link (guests too) plays the same questions once, in their own option order, with no jokers, and
    lands on the link's own board. The creator hears about every result. Links last 7 days.
  - At launch only Дуел and Роял are open as ranked queues (`PUBLIC_QUEUES`), so the first players meet each other
    instead of bots; Отбори, Трио and Арена open as the game grows (and stay playable in private rooms).
- **Rematch:** after a ranked match with other people, anyone can ask for a rematch for a minute; once everyone asks,
  the same people play again (one "no", or walking away, ends the offer).
  - Частна стая: 2–8 players, with configurable questions, timer, category, eliminations and teams.
- **Scoring:** 500 for a correct answer, up to +500 for speed (measured against the regular timer), and +50 per streak
  step (capped at +250). Ties go to more correct answers, then less total time; an unanswered question counts the
  whole timer.
- **Jokers:** one of each per match, and at most one per question. All five unlock by level 6, so ranked play isn't
  decided by time played.
  - 50/50 (level 2): removes two wrong answers.
  - Леден удар (level 3): freezes the leading opponent for 3 seconds.
  - Втори шанс (level 4): allows a second attempt, for half points.
  - Още време (level 5): gives you 5 extra seconds.
  - Двойно или нищо (level 6): doubles the points for one question; a miss costs 500 (never below zero).
- **Leaving and connection drops:** a player who walks out ranks last (the first to leave lowest), unless already
  knocked out, in which case that place stands. A match ends at once when only one side is left. A dropped connection
  is waited for 5 seconds before a question can close without the player; if every human is gone for 30 seconds,
  the rest of the match plays out at once as if they hadn't answered. A result that came in while offline is shown
  on return.
- **Bots** fill ranked seats after a few seconds. A bot plays as strong as the rating it shows (capped at 1600), and
  ratings move less against bots than against people (K 24 vs 40), so Elo settles where a player's skill really is.
  A player's first three multiplayer matches get slightly kinder bots. The same two people only move each other's
  rating three times a day. In private rooms beating bots earns no placement XP.
- **Question variety:** each player's last 1,500 questions are remembered; matches pick questions none of the players
  has seen, then the ones seen longest ago.
- **Anti-cheat:** the server owns the clock, the answers and every player's deadline. Clients never see the correct
  option before the reveal.
- **Seasons:** calendar months in Sofia time. Ratings are per season, and a new season starts players halfway back
  to 1000. At season end, players get XP and exclusive frames and titles for the best peak rank (Бронз → Майстор) they reached
  in a mode where they played at least 10 ranked games.
- **Progression:** every match grants XP: participation, correct answers (by difficulty), placement, a perfect-game
  bonus, the first match of the day, the daily streak (growing for 30 days, with milestones at 7, 30 and 100), daily
  quests and achievements. Reaching level L takes `50·L·(L−1)` total XP.
- **Daily quests:** three a day (Sofia time), one each for showing up, playing well and trying something different,
  chosen per player and fixed for the day; XP is paid as they're completed, plus a bonus for all three.
- **Streak shields:** every 7 days of daily streak earns a shield (at most 2); a missed day uses one up instead of
  breaking the streak. Players with a verified email can opt in to one evening email when their streak is about to
  break (with a one-click unsubscribe). With Brevo's free plan (300 emails a day) that covers a few hundred players.
- **Accounts:** players log in with their username or a verified email. An optional email (verified by link) enables
  "Забравена парола?": a single-use reset link that expires in 1 hour and logs the account out everywhere.
  Passwords can be changed in Настройки.
- **Guests:** "Играй като гост" makes an account without a name or password, so the first game is one tap away.
  Guests play everything except what needs a lasting identity (friends, rooms of their own, challenge links of their
  own, questions, reports), aren't listed on leaderboards, and can save their progress with a name and password at
  any time. A guest account nobody can sign in to any more (no session left) is erased after a day.
- **Moderation:**
  - An offensive-name filter covers Cyrillic, Latin and leetspeak, and reserves names like admin and АЛМАНАХ.
  - Players can report others from their profile.
  - Moderators handle reports in `/admin` → Доклади: dismiss, rename, or ban for 1/7/30 days or permanently.
  - After a match players can review every question and flag a mistake. Moderators see the flags in `/admin` →
    Сигнали, most reported first, and can hide a question from new matches at once (and undo that).
  - The word lists are in `apps/server/src/moderation.ts`.
- **Phones:** the site installs to the home screen (a web app manifest with icons): it then opens full-screen like an
  app, without an app store.
- **Privacy (GDPR):**
  - The privacy policy and terms of use are at `/privacy` and `/terms`.
  - Players can download all their data as JSON and delete their account from Настройки.
  - Fonts are self-hosted, and there are no third-party trackers.
- **Friends:** players send requests by username and see live presence. They can invite friends into a room or
  challenge them to a 1v1 with one click.
- **Community questions:** players at level 3+ submit questions. Moderators (`/admin`) approve them, editing if
  needed, or reject them. Approved questions join the game immediately with author credit, and the author gets XP.
- **Achievements:** 41 in total. Definitions are in `packages/shared/src/achievements.ts` and the rules in
  `apps/server/src/achievements.ts`.

## Adding questions

Players can submit questions in the app, and moderators approve them in `/admin` — that's the way to contribute
questions to the live game.

The live game's bank is kept in a separate private repository (`almanac-questions`), cloned into `private/`
here, a folder this repository ignores:

```bash
git clone git@github.com:almanac-bg/almanac-questions.git private
```

With it present, the server uses `private/questions.json`, and `npm run build` puts it next to the server bundle,
so a Docker image built on a machine that has it includes it. Without it, the server plays the public sample,
`apps/server/src/data/questions.sample.json`. Both files have the same format, and `npm test` validates whichever
are present. To add built-in questions, append to the bank (then commit and push in `private/`):

```json
{ "id": "gen-031", "category": "general", "difficulty": "easy",
  "q": "Колко цвята има българското знаме?", "options": ["3", "2", "4", "5"], "answer": 0 }
```

`answer` is the index of the correct option. Options are shuffled for every match. Categories are `general`,
`science`, `history`, `geography`, `movies`, `music`, `sports`, `technology`, `literature` and `nature`.

## Deploying (any VPS + Docker)

The stack is three containers: the app (plain Node, with SQLite on a volume), Caddy, which handles HTTPS and gets
and renews Let's Encrypt certificates automatically, and Litestream, which streams every database change to
S3-compatible object storage. Nothing ties it to one provider. **2 vCPU and 4 GB** is plenty to start: in a load
test, 1,500 simultaneous players used about 5% of one core. All images run on x86 and ARM.

Choosing the server (prices as of October 2026; check before ordering), in the EU for GDPR and low latency to
Bulgaria:
- **Hetzner** CX23 (€5.99) or CAX11 (ARM, €6.49), in Falkenstein, Nuremberg or Helsinki: the best value when in stock
  (they've often been sold out since September 2026). The always-orderable CPX22 costs about three times more.
- **netcup** VPS 500 (about €8, month to month; Germany or Vienna) or **OVHcloud** VPS-1 (€4.49): good alternatives.

1. **Create the server:** Ubuntu 24.04, logged in with an SSH key (no password logins). In the provider's firewall
   allow TCP 22 (ideally only from your own IP), 80 and 443, and UDP 443 (HTTP/3). Turn on automatic security
   updates: `sudo apt install unattended-upgrades`.
2. **Point DNS at it:** add `A` records for `almanac.bg` and `www.almanac.bg` with the server's IPv4 (and `AAAA`
   for IPv6).
3. **Create the backup bucket:** any S3-compatible storage works. Hetzner Object Storage (about €6.49 a month for
   1 TB, no per-request fees; Cloud Console → Object Storage) is the simple choice even if the server is elsewhere;
   Cloudflare R2 or Backblaze B2 work too. Create a bucket (e.g. `almanac-backups`) and S3 credentials, and set the
   `BACKUP_*` values in `.env` (`BACKUP_REGION` is the location in the endpoint, e.g. `fsn1`; `auto` for R2). If
   the provider offers whole-server backups (Hetzner: **Backups**, +20%), turn them on too.
4. **Install Docker and deploy:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/almanac-bg/almanac.git almanac && cd almanac
   # The private question bank: give the server read access with a deploy key (ssh-keygen -t ed25519, then add
   # the public key in almanac-questions → Settings → Deploy keys, read-only).
   git clone git@github.com:almanac-bg/almanac-questions.git private
   cp .env.example .env        # set DOMAIN, OPERATOR_*, the BACKUP_* values…
   APP_RELEASE=$(git rev-parse --short HEAD) docker compose up -d --build
   ```
5. Open https://almanac.bg and register your account, then make it the admin:
   ```bash
   docker compose exec app node apps/server/dist/cli.mjs admin add <your-username>
   ```
   (`admin list` and `admin remove <username>` work the same way.)
6. **Test the backup once** (the commands are in `deploy/litestream.yml`): restore into a scratch file and check it
   exists. A backup that has never been restored isn't a backup yet. (CI also does a full backup-and-restore with
   the production config on every push.)
7. **Turn on error reports:** create a free Sentry account with the organization in the **EU** region (Frankfurt;
   it can't be changed later), add a project of type "Browser JavaScript", and in its settings turn on "Prevent
   Storing of IP Addresses". Put its DSN in `.env` as `SENTRY_DSN` and run the deploy command again. Server errors
   and crashes in players' browsers then arrive in Sentry (and by email), grouped, with the line of code. Without
   `SENTRY_DSN` nothing is sent anywhere.
8. **Add an uptime check:** a free monitor (UptimeRobot's free plan is for non-commercial sites like this one, or
   Better Stack) on `https://almanac.bg/api/health`, alerting you by email or push.

**Email (password resets, verification, streak reminders):**
1. Create an account with a transactional email provider. Brevo (EU, free up to 300 emails a day), Mailgun EU and
   Postmark all work.
2. Authenticate the `almanac.bg` domain there by adding the DNS records it gives you (DKIM, DMARC, a verification
   code), and add the sender `no-reply@almanac.bg`.
3. Put the SMTP details in `.env` as `SMTP_URL` and run the deploy command again. Brevo's SMTP login contains an `@`:
   write it as `%40` in the URL, e.g. `smtp://8a1b2c001%40smtp-brevo.com:KEY@smtp-relay.brevo.com:587`.

Use port **587**: many providers (Hetzner among them) block outgoing ports 25 and 465 on new servers.

**Before launch:** set your name, a correspondence address, the email provider and the hosting provider in `.env`
(`OPERATOR_NAME`, `OPERATOR_ADDRESS`, `EMAIL_PROVIDER`, `HOSTING_PROVIDER`; they're never in the code); the
service is run by a private individual, and the privacy policy and terms show these details. Both documents are
drafts: have them reviewed for your situation.

**Updating:** `git pull && git -C private pull && APP_RELEASE=$(git rev-parse --short HEAD) docker compose up -d --build` (the release tag
lets error reports say which version they came from). The new version builds while the old one keeps running.
Then the old one stops gracefully: queued players are told an update is coming, no new matches start, and running
matches play to the end (up to ~5½ minutes, `DRAIN_SECONDS`) before it restarts. While it's down for those few
seconds, Caddy shows a page that reloads by itself, and players' browsers reconnect automatically.

**Backups:** three layers.
1. **Litestream (continuous, off-site):** every change reaches object storage within seconds; any moment of the last
   7 days can be restored. Restore commands are in `deploy/litestream.yml`.
2. **Daily snapshots (automatic, on the server):** after 04:00 Sofia time the app writes a consistent copy of the
   database to `/data/backups/quiz-YYYY-MM-DD.db` and keeps the last 14 (`BACKUP_KEEP_DAYS`). Handy for undoing a
   mistake quickly; they live on the same disk.
3. **The provider's server backups** (if it offers them): daily images of the whole server, kept off the machine.

To restore a daily snapshot:
```bash
docker compose stop app
docker compose run --rm --no-deps --entrypoint sh app -c 'ls /data/backups'   # pick a day
docker compose run --rm --no-deps --entrypoint sh app -c \
  'cp /data/quiz.db /data/quiz-before-restore.db && cp /data/backups/quiz-2026-10-25.db /data/quiz.db && rm -f /data/quiz.db-wal /data/quiz.db-shm'
docker compose start app
```

**Monitoring:**
- **Uptime:** `/api/health` answers 200 only while the app and its database work (see step 8).
- **Errors:** Sentry, when `SENTRY_DSN` is set (see step 7). Reports carry the place in the code and the account
  number only; the browser sends them through the app (`/api/monitoring`), never to Sentry directly, and they are
  capped at 20 a minute so a bug in a loop can't use up the free plan (5,000 a month). Everything is also in the log
  (`💥` for the server, `🧯` for browsers).
- **Launch statistics:** `/admin` → Статистика: active players per day, new players (accounts and guests), saved
  guest accounts, matches, challenge links, the daily challenge, and how many new players come back the next day and
  a week later. Counted on the server as things happen; no cookies, no tracking, no third parties.
- **Updates:** Dependabot opens weekly pull requests for npm packages, the Node base image, Caddy, Litestream and
  the CI actions (security fixes right away); CI tests each one.

**Logs:** `docker compose logs -f app` (rotated: 5 × 10 MB per container).

Live matches, queues and rooms are held in memory, so run a single app instance.

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately, as
described in [SECURITY.md](SECURITY.md).

## License

The code is free software under the **GNU Affero General Public License v3.0 or later** ([LICENSE](LICENSE)). You
may run, study, change and share it. If you run a changed version as a public website, its users must be able to get
your source code: the footer's "Изходен код" link (`SOURCE_URL`) is there for that.

Not covered by the license:
- **The name АЛМАНАХ, its logo and the almanac.bg domain.** A copy you run publicly needs its own name and branding
  (`packages/shared/src/brand.ts`, the icons in `apps/web/public`).
- **The game's question bank**, which isn't in this repository. The sample bank in it is part of the code and may be
  used with it.

## GitHub repository settings

`scripts/github-setup.sh almanac-bg/almanac` sets up the GitHub side (safe to run again): description, website and
topics, issues and discussions, squash merges, Dependabot alerts and security updates, private vulnerability
reporting, secret scanning, labels and a protected `main`. Some of these exist only for public repositories, so
run it again after making the repository public. The social preview image (`.github/social-preview.png`) is
uploaded by hand: Settings → General → Social preview.

