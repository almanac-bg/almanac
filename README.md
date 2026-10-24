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

Open http://localhost:5173, register an account, and play. **The first account you register becomes the admin**, so
it can approve community questions.

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

`npm test` runs three suites with Node's built-in test runner:
- **`e2e.test.ts`** boots a real server with a throwaway database and plays through everything with real sockets.
  Two players and bots cover: solo, a ranked duel with a reconnect, Royale eliminations, private rooms and teams,
  the daily challenge, friends, invites and challenges, every joker, community questions with moderation, and season
  rewards.
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
| `ADMIN_USERNAMES`  |                                       | Extra moderators (comma-separated usernames)                 |
| `APP_URL`          | `http://localhost:5173`               | Public origin used in email links                            |
| `SMTP_URL`         |                                       | e.g. `smtp://user:pass@host:587`. Unset → emails are printed to the console |
| `MAIL_FROM`        | `АЛМАНАХ <no-reply@almanac.bg>`       | Sender address                                               |
| `QUESTIONS_PATH`   | `apps/server/src/data/questions.json` | Built-in question bank                                       |
| `GAME_TIME_SCALE`  | `1`                                   | Multiplies all in-game timers. For automated tests only      |

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
  src/data/questions.json Built-in question bank (800 questions, 10 categories)
packages/client   Client core: API calls, realtime game state (zustand), formatting. The website
                  plugs in its sounds; kept separate so other clients can reuse it
apps/web          React 19 + Vite + Tailwind 4 + Motion
```

## How it plays

- **Modes:**
  - Соло: 10 questions, pick a category.
  - Дневно предизвикателство: the same 10 questions for everyone, one attempt a day, no jokers, its own leaderboard.
  - Дуел: 1v1.
  - Отбори: 2v2, with teams balanced by rating.
  - Трио: 3 players.
  - Арена: 5 players.
  - Роял: 8 players. The lowest scorer is knocked out after questions 3, 5, 7, 9, 11 and 13.
  - Частна стая: 2–8 players, with configurable questions, timer, category, eliminations and teams.
- **Scoring:** 500 for a correct answer, up to +500 for speed, and +50 per streak step (capped at +250).
- **Jokers:** one of each per match, and at most one per question.
  - 50/50 (level 3): removes two wrong answers.
  - Двойно или нищо (level 6): doubles the points for one question.
  - Леден удар (level 9): freezes the leading opponent for 3 seconds.
  - Втори шанс (level 12): allows a second attempt, for half points.
  - Още време (level 15): gives you 5 extra seconds.
- **Anti-cheat:** the server owns the clock, the answers and every player's deadline. Clients never see the correct
  option before the reveal.
- **Seasons:** calendar months in Sofia time. Ratings are per season, and a new season starts players halfway back
  to 1000. At season end, players with 3+ ranked games get XP and exclusive frames and titles for their best rank
  (Бронз → Майстор).
- **Progression:** every match grants XP: participation, correct answers (by difficulty), placement, a perfect-game
  bonus, the first match of the day, the daily streak and achievements. Reaching level L takes `50·L·(L−1)` total
  XP.
- **Accounts:** players log in with their username or a verified email. An optional email (verified by link) enables
  "Забравена парола?": a single-use reset link that expires in 1 hour and logs the account out everywhere.
  Passwords can be changed in Настройки.
- **Moderation:**
  - An offensive-name filter covers Cyrillic, Latin and leetspeak, and reserves names like admin and АЛМАНАХ.
  - Players can report others from their profile.
  - Moderators handle reports in `/admin` → Доклади: dismiss, rename, or ban for 1/7/30 days or permanently.
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

The stack is two containers: the app (plain Node, with SQLite on a volume) and Caddy, which handles HTTPS and gets
and renews Let's Encrypt certificates automatically. A **CX22** (2 vCPU, 4 GB) is plenty to start.

1. **Create the server:** a Hetzner Cloud server with Ubuntu 24.04. In the firewall, allow ports 22, 80 and 443.
2. **Point DNS at it:** add `A` records for `almanac.bg` and `www.almanac.bg` with the server's IPv4 (and `AAAA`
   for IPv6).
3. **Install Docker and deploy:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone <your repo> almanac && cd almanac
   cp .env.example .env        # set DOMAIN, optionally ADMIN_USERNAMES and backups
   docker compose up -d --build
   ```
4. Open https://almanac.bg and register. The first account becomes the admin.

**Email (password resets):**
1. Create an account with a transactional email provider. Brevo (EU, free up to 300 emails a day), Mailgun EU and
   Postmark all work.
2. Verify the `almanac.bg` domain there by adding the SPF and DKIM DNS records the provider gives you.
3. Put the SMTP details in `.env` as `SMTP_URL` and run `docker compose up -d`.

Use port **587**: Hetzner blocks outgoing ports 25 and 465 on new cloud servers.

**Before launch:** fill in the operator details (`LEGAL` in `packages/shared/src/brand.ts`). The privacy policy and
terms show them. Both documents are drafts: have them reviewed for your situation.

**Updating:** `git pull && docker compose up -d --build`. Live matches end on restart; accounts and stats are kept.

**Backups:** pick either option.
- **Hetzner's server backups:** a checkbox on the server.
- **Litestream:** streams every database change to Hetzner Object Storage within seconds. Fill in the `BACKUP_*`
  values in `.env` and run `docker compose --profile backup up -d`. See `deploy/litestream.yml` for how to restore.

**Logs:** `docker compose logs -f app`.

Live matches, queues and rooms are held in memory, so run a single app instance.
