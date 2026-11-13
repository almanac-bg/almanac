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
