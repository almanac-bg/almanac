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
  - `split/clues`: about half of each.
  - A hard `number` is an **estimate**: a unit, an answer above 20, one accepted value, a tolerance by the skill. The day
    ends on it; a year or a small count is a choice in disguise.
  - `picture`: an easy choice with a picture (see Pictures).
  - **`dated`**: one question for each of your `dates`, in order (the first `count`, the spares on the rest), each with
    `"on": ["MM-DD"]`. A dated question is a choice without a picture (any difficulty), an easy true-or-not, or a hard
    estimate number. It is about what happened on, or is marked on, that exact day (a birth, a death, an event, a
    holiday, a name day, a world day), and its fact says why the day in passing („На 3 март 1878 г. …“). Bulgarian
    events before 1916: the New Style date Bulgaria marks today. If a date truly has nothing worth asking in your
    category, take the next of your dates and say so in your notes.
- **`firstId` … `lastId`**: your ids. Number your questions from `firstId` up, one by one, no gaps.
- **`avoid`**: subjects your category names too often already. Write away from them; never a question whose answer or
  main subject is one of them.
- **About Bulgaria: your entry's `bg`** questions (about 30% of the batch), each cell's `bg` of its `count`
  (`"bg": true`: Bulgarian people, places, history, culture, language, food, customs, sport, institutions, nature; not
  merely written in Bulgarian). Every day needs three. If a cell's subject truly can't give its `bg` honestly, write
  the rest in another cell of yours and say so in your notes; never mark a question `bg` that isn't about Bulgaria.
  Everyday Bulgaria after 2015 is welcome; never news that goes stale (pin what can change to a date and add
  `reviewBy`: from that day no game deals it until it is checked again).
- Every question: `added` and `updated` = the plan's `date`, a fact.
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
original's size, at least 600 px) and one at half that size: `cwebp -q 80 -resize <w> <h> in -o out.webp`. Name the
big one `<first 16 hex digits of the sha256 of its bytes>.webp` and the small one `<same>-600.webp`, each at most
150 kB (lower `-q` until it is), both in `<batch>/write/<category>/images/`; `w` and `h` in the question are the big
file's. Delete `raw/` when you're done.

## Deliver

- `<batch>/write/<category>/<category>.json`: one JSON array of complete bank questions, in id order.
- `<batch>/write/<category>/images/`: the pictures they use, nothing else (no other file in that folder).
- `<batch>/sources/<category>.json`: `{"<id>": ["<url>", …]}`, the pages you confirmed each question from.

Check it against the real bank before you finish, and fix what it reports for your ids:

```bash
cd <repo> && go run ./cmd/almanac bank add -check <batch>/write/<category> <bank>
```

It writes nothing; it fails on any error, prints the warnings about your questions (fix those too, unless the
warning is plainly wrong for the question), and says how big each category would be.

Your final answer (structured): how many you wrote, by cell; the dates you couldn't fill and why; anything you're
not fully sure of, by id (`unconfirmed`); and problems you found in questions already in the bank (by id, with the
source), which you don't touch.
