# Writing a category's part of a batch

You write new questions for АЛМАНАХ, a Bulgarian quiz game, in one category. A checker who trusts nothing will go
over every question after you, and then a cross-check over all ten categories: what you can't stand behind is
dropped there, so write only what you have confirmed.

Your prompt gives you: `<skill>` (this folder), `<repo>` (the game's code), `<bank>` (the real bank, **read-only**:
never edit it), `<batch>` (this batch's folder) and your category.

## Read first

1. `<repo>/.claude/skills/questions/SKILL.md`: the rules for every question, fact and picture, the difficulty rubric,
   the format, the Bulgarian style. Follow all of it.
2. Your entry in `<batch>/plan.json` (`categories[]` with your `id`), and `focus` at the top if the owner gave one.
3. One recent report in `<bank>/reports/` (the newest file) to see the house style.

## What the plan asks

- **`cells`**: what to write: `count` questions of `kinds` and `difficulty` (with a picture over the question if
  `picture`), `bg` of them about Bulgaria, and `spares` more of the same. Write `count + spares` of each: the
  checker's drops come out of the spares.
  - Never a `clues` question: „Подсказки“ are switched off (2026-11-23), and `bank add` refuses one. The place
    clues shared with splits is a split's.
  - A `number` is an **estimate**: a year, or a quantity of more than 20 of its steps, with one accepted value and
    the tolerance of the skill's formula (`bank check` says the figure). A small count is a choice in disguise. The
    day ends on a hard number, and only a quantity takes that place (a unit, an answer above 20: the day's draw
    doesn't end on a year), so a hard `number` cell is a quantity a well-read person can only estimate, and can
    estimate: it has an anchor they carry (a height, a distance, an age, a duration, a famous total), named in its text
    or fact, never an archive's count (a series' episodes, a hall's seats, a council's members, prize money, the
    species in a plan, a composer's works, a player's goals or awards, the times something was done: the `countable`
    rule refuses them). On an offset scale (°C, °, points, a rating) the tolerance is judged, under 1/5 of the answer;
    and the text shows no number near the answer, in figures or in a name („Стоте дни“).
  - An easy `truefalse` is a common misconception put plainly, never a truism nobody can miss.
  - `picture`: an easy choice with a picture (see Pictures).
  - **`dated`**: one question for each of your `dates`, in order (the first `count`, the spares on the rest), each with
    `"on": ["MM-DD"]`. A dated question is a choice without a picture (any difficulty), an easy true-or-not, or a hard
    estimate number. It is about what happened on, or is marked on, that exact day (a birth, a death, an event, a
    holiday, a name day, a world day), and it has its **`day` line**: one short sentence (at most 100 characters,
    ending in a period) that says what happened that day and names the date: `"day": "На 16 декември 1982 г. умира
    Колин Чапман."`. The player reads it with the answer, over the fact, only on that date. So the text names the date
    only when the date is what's asked (not „Колин Чапман, починал на 16 декември 1982 г., основава…“), and the fact
    says something new, never the date again. A true-or-not never names its date: dealt on it, it would answer
    itself. A story with a Bulgarian or human angle beats a template („Коя държава празнува на …?“): at most one
    template among your dates. Bulgarian events before 1916: the New Style date Bulgaria marks today. If a date truly has nothing worth asking in your category, take the next of your dates and say so in your notes.
- **`firstId` … `lastId`**: your ids. Number your questions from `firstId` up, one by one, no gaps.
- **`avoid`**: subjects your category names too often already. Write away from them; never a question whose answer or
  main subject is one of them.
- **`themes`**: your chapter's themes, those the batch writes into first (each `write` > 0: the themes furthest short
  of their target share, those about Bulgaria, `bg`, first), with what each `covers` in `<bank>/themes.json`. Spread
  your questions over them about as `write` says, across your cells (a hard number in Средновековна България, an easy
  choice in Биология…); write none into a theme with `write` 0 unless a cell can't be filled honestly otherwise (say
  so in your notes), and none into „друго“ (`other`) or „Смесени“ (`mixed`) by design. Your questions about Bulgaria
  (`bg`) go first into the Bulgarian themes the plan names. **Every question carries `"theme"`**: the id of the one
  theme it is mainly about (the more specific when two fit; `mixed` only for a match, split or order over several;
  `other` only when none fits). `bank add` refuses a new question without one, or with a theme its chapter doesn't
  have.
- **About Bulgaria: your entry's `bg`** questions (about 30% of the batch), each cell's `bg` of its `count`
  (`"bg": true`: Bulgarian people, places, history, culture, language, food, customs, sport, institutions, nature; not
  merely written in Bulgarian). Every day needs three. If a cell's subject truly can't give its `bg` honestly, write
  the rest in another cell of yours and say so in your notes; never mark a question `bg` that isn't about Bulgaria.
  Everyday Bulgaria after 2015 is welcome; never news that goes stale (pin what can change to a date and add
  `reviewBy`: from that day no game deals it until it is checked again).
- Every question: `added` and `updated` = the plan's `date`, a fact of at most 140 characters about the answer, its
  `theme`, and a subject that belongs under your category (a player of the category expects it there).
- Spread the difficulty honestly by the rubric: a question is labelled for what Bulgarian players know, not for its
  cell. If a question you wrote is easier or harder than its cell, write another one for the cell.

## Before each question

- **Grep the bank** (`<bank>/questions/*.json`, case-insensitively, Cyrillic and Latin spellings) for the subject, the
  answer, the key names and numbers. No near-duplicate, no "who or what is this" answer the bank asks already, and
  nothing in the bank that gives yours away or that yours gives away (text, options, items, clues, facts, and the
  values an order or number question asks). This is where most drops come from.
- **Confirm from a source you have read in this session**: the answer, each wrong option being wrong, every number,
  date and name, and the fact. Reliable: bg.wikipedia.org, en.wikipedia.org, Britannica, official and institutional
  sites, Wikimedia Commons file pages for pictures. Fetch the page itself with WebFetch: it's more reliable than search
  snippets and spares the search quota. WebSearch is rate-limited: when it fails, go on with WebFetch of the pages you
  need. **What you can't confirm, don't write**: write another question for the cell.
- Never send personal data anywhere: no names or email addresses in search queries, URLs or headers.

## Pictures

Free licences only (PD, CC0, CC BY, CC BY-SA), read on the file's Commons page; an artwork only if its artist died 70
or more years ago; no film stills, posters, covers, logos, banknotes or screenshots; no legible text that names the
answer. `alt` describes the picture without naming it; `credit`, `license`, `licenseVersion`, `source` (the Commons
file page) come from the file's page. Look at every picture yourself (the Read tool shows images) before you use it.

Making the files: download the original from upload.wikimedia.org (nothing but image files, nothing from anywhere
else) into `<batch>/write/<category>/raw/`, then make a webp whose longer side is at most 1200 px (keep a smaller
original's size, at least 600 px), one at three quarters of that size and one at half (each side rounded down):
`cwebp -q 80 -m 6 -resize <w> <h> in -o out.webp`. Name the big one `<first 16 hex digits of the sha256 of its
bytes>.webp`, the three-quarter one `<same>-900.webp` and the half one `<same>-600.webp`, each at most 150 kB (lower `-q`
until it is), all three in `<batch>/write/<category>/images/`; `w` and `h` in the question are the big file's. Delete
`raw/` when you're done.

## Deliver

- `<batch>/write/<category>/<category>.json`: one JSON array of complete bank questions, in id order.
- `<batch>/write/<category>/images/`: the pictures they use, nothing else (no other file in that folder).
- `<batch>/sources/<category>.json`: `{"<id>": ["<url>", …]}`, the pages you confirmed each question from.

Check it against the real bank before you finish, and fix what it reports for your ids:

```bash
cd <repo> && go run ./cmd/almanac bank add -check <batch>/write/<category> <bank>
```

It writes nothing; it fails on any error, prints the warnings about your questions (fix those too, unless the
warning is plainly wrong for the question), and says how big each category would be. Every rule of the skill's
"The rules code checks" is an **error** for a new question: a give-away with a question in the bank, a word of the
answer in a clue, a small count as a number, a tolerance off the formula, an option that stands out by its form. Fix
the question; if the rule is truly wrong for it, say so in your final answer (only the owner's session waives a
rule).

Your final answer (structured): how many you wrote, by cell; the dates you couldn't fill and why; anything you're
not fully sure of, by id (`unconfirmed`); and problems you found in questions already in the bank (by id, with the
source), which you don't touch.
