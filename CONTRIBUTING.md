# Contributing to АЛМАНАХ

Thanks for helping! Bug reports, fixes and improvements are all welcome. The game is in Bulgarian; code, comments
and discussions here are in English (Bulgarian is fine too).

## Getting started

Node 24+ is all you need (the database is SQLite, built into Node):

```bash
npm install
npm run dev        # server on :3001, web app on :5173
```

A fresh checkout plays a 120-question sample bank; the live game's bank is private. The first account you register
in development is a moderator, so you can try `/admin` too. See the [README](README.md) for the layout of the code.

## Before you open a pull request

- `npm run typecheck` and `npm test` pass. For changes to the web app, also run the browser tests:
  `BROWSER_PATH=<path to a Chromium-based browser> npm run test:browser` (CI runs them with Chrome).
- New behaviour comes with a test: `apps/server/test` (Node's test runner) for the server and game rules,
  `apps/web/e2e` (Playwright) for whole flows in the browser.
- Database changes are a new migration appended to the list in `apps/server/src/db.ts`; never edit an existing one
  (live databases have already run it).
- Keep pull requests focused: one change, explained in its description.

## Style

- Match the code around you: its naming, comment density and idioms. Comments say *why*, not what.
- Text players see is in **Bulgarian** and **gender-neutral**: no masculine or feminine forms when addressing the
  player ("Ти си в стая", "Имаш покана" — not "Поканен си", "готов", "влязъл").
- The web app must work on a 320 px wide phone (no sideways scrolling), with 44 px touch targets, keyboard access
  and screen-reader labels.
- The server owns the rules: the clock, answers and scoring never trust the client.

## Questions for the game

Questions are added in the game itself ("Предложи въпрос", from level 3) and reviewed by moderators, not through
pull requests.

## License

By contributing, you agree that your contribution is licensed under the project's license, the
[GNU AGPL v3.0 or later](LICENSE).
