# АЛМАНАХ ⚡ — almanac.bg

Real-time multiplayer quiz battles, in Bulgarian. It has:

- **Modes:** solo practice, a daily challenge, ranked 1v1 duels and 2v2 teams, 3- and 5-player free-for-alls, an
  8-player Royale with eliminations, and private rooms for friends.
- **Progression:** accounts level up, unlock cosmetics and jokers, earn achievements, climb monthly seasons and keep
  detailed statistics.
- **Social:** players can add friends, invite and challenge each other, and submit their own questions for review.

## Quick start

Requires Node 22.13+. It uses the built-in `node:sqlite`, so there's no database to install.

```bash
npm install
npm run dev
```

Open http://localhost:5173, register an account, and play. In development **the first account you register becomes
the admin**, so it can approve community questions. In production nobody becomes an admin by signing up; see
step 5 of [Deploying](#deploying-hetzner--docker).

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
  rewards, flagging and hiding wrong questions, results replayed after a dropped connection, malformed socket
  messages (which must never crash the server), and how the website's files are cached.
- **`game.test.ts`** drives the match engine on a mocked clock: leaving and forfeits, dropped connections, abandoned
  matches, "Двойно или нищо", tie-breaks and bot strength.
- **`restart.test.ts`** covers graceful restarts (running matches finish first) and a daily attempt cut short by a crash.
- **`database.test.ts`** checks the per-player question history and that hot queries use indexes.
- **`production.test.ts`** runs the server as in production: admins only through the admin command line, browser security
  headers, the health check, crash reports.
- **`maintenance.test.ts`** covers the cleanup of expired logins and the daily database snapshots.
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
| `COOKIE_SECURE`    | `false`                               | Set `true` when served over HTTPS                            |
| `TRUST_PROXY`      | `loopback`                            | Express `trust proxy`; which reverse proxies to trust        |
| `APP_URL`          | `http://localhost:5173`               | Public origin used in email links                            |
| `SMTP_URL`         |                                       | e.g. `smtp://user:pass@host:587`. Unset → emails are printed to the console |
| `MAIL_FROM`        | `АЛМАНАХ <no-reply@almanac.bg>`       | Sender address                                               |
| `QUESTIONS_PATH`   | `apps/server/src/data/questions.json` | Built-in question bank                                       |
| `GAME_TIME_SCALE`  | `1`                                   | Multiplies all in-game timers. For automated tests only      |
| `BACKUP_DIR`       | `backups` next to the database        | Daily database snapshots; `off` disables them                |
| `BACKUP_KEEP_DAYS` | `14`                                  | How many daily snapshots to keep                             |
| `DRAIN_SECONDS`    | `330` in production, `0` otherwise    | On shutdown, how long running matches may finish first       |

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
  src/data/questions.json Built-in question bank (~2,000 questions, 10 categories)
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
  bonus, the first match of the day, the daily streak (growing for 30 days, with milestones at 7, 30 and 100) and
  achievements. Reaching level L takes `50·L·(L−1)` total
  XP.
- **Accounts:** players log in with their username or a verified email. An optional email (verified by link) enables
  "Забравена парола?": a single-use reset link that expires in 1 hour and logs the account out everywhere.
  Passwords can be changed in Настройки.
- **Moderation:**
  - An offensive-name filter covers Cyrillic, Latin and leetspeak, and reserves names like admin and АЛМАНАХ.
  - Players can report others from their profile.
  - Moderators handle reports in `/admin` → Доклади: dismiss, rename, or ban for 1/7/30 days or permanently.
  - After a match players can review every question and flag a mistake. Moderators see the flags in `/admin` →
    Сигнали, most reported first, and can hide a question from new matches at once (and undo that).
  - The word lists are in `apps/server/src/moderation.ts`.
- **Privacy (GDPR):**
  - The privacy policy and terms of use are at `/privacy` and `/terms`.
  - Players can download all their data as JSON and delete their account from Настройки.
  - Fonts are self-hosted, and there are no third-party trackers.
- **Friends:** players send requests by username and see live presence. They can invite friends into a room or
  challenge them to a 1v1 with one click.
- **Community questions:** players at level 3+ submit questions. Moderators (`/admin`) approve them, editing if
  needed, or reject them. Approved questions join the game immediately with author credit, and the author gets XP.
- **Achievements:** 39 in total. Definitions are in `packages/shared/src/achievements.ts` and the rules in
  `apps/server/src/achievements.ts`.

## Adding questions

Players can submit questions in the app. To add built-in ones, append to `apps/server/src/data/questions.json`:

```json
{ "id": "gen-031", "category": "general", "difficulty": "easy",
  "q": "Колко цвята има българското знаме?", "options": ["3", "2", "4", "5"], "answer": 0 }
```

`answer` is the index of the correct option. Options are shuffled for every match. Categories are `general`,
`science`, `history`, `geography`, `movies`, `music`, `sports`, `technology`, `literature` and `nature`.

## Deploying (Hetzner + Docker)

The stack is three containers: the app (plain Node, with SQLite on a volume), Caddy, which handles HTTPS and gets
and renews Let's Encrypt certificates automatically, and Litestream, which streams every database change to object
storage. A **CX22** (2 vCPU, 4 GB) is plenty to start: in a load test, 1,500 simultaneous players used about 5% CPU.

1. **Create the server:** a Hetzner Cloud server with Ubuntu 24.04. In the firewall, allow TCP 22, 80 and 443, and UDP 443 (HTTP/3).
2. **Point DNS at it:** add `A` records for `almanac.bg` and `www.almanac.bg` with the server's IPv4 (and `AAAA`
   for IPv6).
3. **Create the backup bucket:** in the Hetzner Cloud Console → Object Storage, create a bucket (e.g. `almanac-backups`)
   and S3 credentials for it. Also tick **Backups** on the server itself.
4. **Install Docker and deploy:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone <your repo> almanac && cd almanac
   cp .env.example .env        # set DOMAIN and the BACKUP_* values
   docker compose up -d --build
   ```
5. Open https://almanac.bg and register your account, then make it the admin:
   ```bash
   docker compose exec app node apps/server/dist/cli.mjs admin add <your-username>
   ```
   (`admin list` and `admin remove <username>` work the same way.)
6. **Test the backup once** (the commands are in `deploy/litestream.yml`): restore into a scratch file and check it
   exists. A backup that has never been restored isn't a backup yet.

**Email (password resets):**
1. Create an account with a transactional email provider. Brevo (EU, free up to 300 emails a day), Mailgun EU and
   Postmark all work.
2. Verify the `almanac.bg` domain there by adding the SPF and DKIM DNS records the provider gives you.
3. Put the SMTP details in `.env` as `SMTP_URL` and run `docker compose up -d`.

Use port **587**: Hetzner blocks outgoing ports 25 and 465 on new cloud servers.

**Before launch:** fill in your name and a correspondence address (`LEGAL` in `packages/shared/src/brand.ts`); the
service is run by a private individual, and the privacy policy and terms show these details. Both documents are
drafts: have them reviewed for your situation.

**Updating:** `git pull && docker compose up -d --build`. The new version builds while the old one keeps running.
Then the old one stops gracefully: queued players are told an update is coming, no new matches start, and running
matches play to the end (up to ~5½ minutes, `DRAIN_SECONDS`) before it restarts. While it's down for those few
seconds, Caddy shows a page that reloads by itself, and players' browsers reconnect automatically.

**Backups:** three layers.
1. **Litestream (continuous, off-site):** every change reaches Hetzner Object Storage within seconds; any moment of
   the last 7 days can be restored. Restore commands are in `deploy/litestream.yml`.
2. **Daily snapshots (automatic, on the server):** after 04:00 Sofia time the app writes a consistent copy of the
   database to `/data/backups/quiz-YYYY-MM-DD.db` and keeps the last 14 (`BACKUP_KEEP_DAYS`). Handy for undoing a
   mistake quickly; they live on the same disk.
3. **Hetzner's server backups:** daily images of the whole server, kept off the machine (+20% of its price).

To restore a daily snapshot:
```bash
docker compose stop app
docker compose run --rm --no-deps --entrypoint sh app -c 'ls /data/backups'   # pick a day
docker compose run --rm --no-deps --entrypoint sh app -c \
  'cp /data/quiz.db /data/quiz-before-restore.db && cp /data/backups/quiz-2026-10-25.db /data/quiz.db && rm -f /data/quiz.db-wal /data/quiz.db-shm'
docker compose start app
```

**Monitoring:** add a free uptime check (e.g. UptimeRobot or Better Stack) on `https://almanac.bg/api/health`. It
answers 200 only while the app and its database work. Crashes in players' browsers are reported to the server log
as lines starting with 🧯.

**Logs:** `docker compose logs -f app` (rotated: 5 × 10 MB per container).

Live matches, queues and rooms are held in memory, so run a single app instance.
