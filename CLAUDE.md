# АЛМАНАХ

A quiz game for Bulgarian players at almanac.bg: a Go server (`cmd/`, `internal/`) and a plain TypeScript client
(`web/`). How it's built and checked is in `README.md`; how it looks and speaks is in `web/DESIGN.md`.

## The game is in Bulgarian

Everything a player can see — screens, buttons, tiers, titles, achievements, mails, errors, notifications, questions
and facts — is in **standard literary Bulgarian**. Code, comments, commit messages, URLs and ids are in English.

- **Bulgarian words, not Russian ones.** Russian is close enough that its words pass unnoticed, so check every word
  you're not sure of in a Bulgarian dictionary ([РБЕ](https://ibl.bas.bg/rbe/),
  [rechnik.chitanka.info](https://rechnik.chitanka.info)), and when a word is only "also used", pick the plain,
  common Bulgarian one. Known slips: знаток → експерт or познавач; ответ → отговор; вопрос → въпрос; игрок → играч;
  уровень → ниво; сейчас → сега.
- **Bulgarian letters only:** never ё, ы or э.
- **No Bulgarian in Latin letters**, anywhere: a route is `/daily`, never `/dnes`.
- **The house style** is in `web/DESIGN.md` (Copy): „ти“ to one player, short plain sentences, gender-neutral,
  numbers the Bulgarian way. Questions follow the `questions` skill.

`web/src/language.test.ts` (part of `npm test`) fails on a non-Bulgarian letter or a known Russian word in the
client, the server or the sample bank. It catches only what it knows: reading the words is still the check.

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
- **A migration takes the next free number on `main`** when you open the PR. If another lands first, renumber yours
  and push: the Server check fails within a minute on two migrations with one number.
