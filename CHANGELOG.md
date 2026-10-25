# Changelog

All notable changes to АЛМАНАХ. Versions follow [Semantic Versioning](https://semver.org/); dates are Sofia time.

## [0.9.0] — 2026-10-25 · Ready for launch

The first complete version: everything the game needs to open to the public at almanac.bg.

### Play
- Real-time quiz battles in Bulgarian: solo, a daily challenge, ranked Дуел and Роял (8 players, eliminations)
  — plus Трио, Арена and 2 на 2 teams, ready to open as the game grows — and private rooms for friends.
- Challenge links: ten fixed questions anyone with the link plays once, with a board per link.
- Guest play: a first game in one tap, with the progress saved later by choosing a name and password.
- Rematches with the same opponents, friends and invites, five jokers ("Двойно или нищо" risks 500 points).
- Levels, cosmetics, 41 achievements, daily quests, a daily streak with shields, and monthly ranked seasons.
- Fair matchmaking: bots play as strong as the rating they show, and win-trading between accounts is limited.
- About 2,000 fact-checked questions in 10 categories; players submit more, moderators review them.

### Built for running it
- One Node server (Express, Socket.IO, SQLite) with a server-authoritative game engine that survives bad input,
  dropped connections and restarts (running matches finish before a deploy).
- Continuous backups (Litestream) tested by a full restore in CI, daily snapshots, and graceful updates.
- Accounts with hashed sessions, email verification and password resets, moderation, reports and bans.
- Privacy by design: GDPR data export and deletion, no tracking; launch statistics counted on the server.
- Error reports (Sentry, optional), Dependabot, and server, game-engine and browser tests in CI.
- Mobile-first, accessible web app that installs to the home screen.

[0.9.0]: ../../releases/tag/v0.9.0
