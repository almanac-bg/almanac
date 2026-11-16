---
name: questions
description: Write, change, check or retire questions in АЛМАНАХ's bank (private/questions/*.json, or the public sample in bank/sample). Use for every change to the questions — new batches, facts („Знаеше ли?“), rewording, difficulty, fixing a reported question — and before asking any agent to write questions.
---

# The questions

The questions are the game. A wrong answer or a wrong fact is the worst bug АЛМАНАХ can ship, because players learn
from it. Nothing goes into the bank unchecked, and every rule below holds for every question, whoever wrote it.

## Where things are

- `private/` is a clone of the private repo `almanac-bg/almanac-questions`, ignored by this repo. It holds
  `categories.json` and `questions/<category>.json`: the real bank, kept private so answers can't be searched. Never
  paste many of its questions anywhere public.
- `bank/sample/` is the public sample that CI and the browser tests play. Its answers are public.
- The format and the checks are the code: `internal/bank` (one file per type, `check.go` for the format,
  `rules.go` and the files it names for the rules below, `balance.go`). `internal/bank/names.json` is the spelling of
  names written more than one way; `internal/bank/language.json` the Russian words and loanwords the game never uses
  (the client's language test reads it too). A bank's `waivers.json` (in `private/`) lists its true exceptions.
- The tools (from the repo root):
  - `go run ./cmd/almanac bank fmt private` writes the files in their one format, and sets the typography kept one
    way („…“ for three dots, „ — “ for a spaced hyphen, a no-break space between a number and its „г.“); run it after
    every edit;
  - `almanac bank used`, on the server, prints the question ids the days have had (played and drawn ahead) and the
    last day drawn, nothing of a player's; fetch it into a file for `-used` (the `new-questions` skill shows the ssh
    line);
  - `go run ./cmd/almanac bank plan [-n N] [-json] [-used file] private` plans a batch of N a topic: the cells to
    write (the day's shortest runway first, at most a third of the batch in one place), how many about Bulgaria (30%,
    per cell: `bg`), the dates with the fewest questions left, the ids and the subjects to avoid;
  - `go run ./cmd/almanac bank add [-check] [-checked-by P] <batch> private` adds a batch (`<category>.json` files,
    `images/`, maybe `retire.json`: `[{"id", "why", "by"}]`): every new id the next free one, the bank with it in
    loading with no errors, or nothing is written; `-check` only checks; `-checked-by` marks the new questions
    checked today by that process;
  - `go run ./cmd/almanac bank check [-used file] private` checks everything the server checks before it plays a
    bank: the format and **every rule below that code can judge**. It prints every error, then the balance report:
    the difficulty and kind mix, facts and dates, each category's kinds against their share, and **the day's
    runway** — how many days from today each place of a day has questions for, and the day it runs out on. It
    **fails** on an error, and while a category is more than 2% off the mean size (`bank.SizeSlack`; `-unbalanced`
    lets the small public sample pass), and **warns** of every place under 150 days (`play.RunwayWarn`: the 90 days
    drawn ahead and 60 to write). Then **the subjects that come back** (listed, never failed): the answers and names
    more than 15 live questions name, by category (`*` over 1% of one); the top 20, all of them with
    `go run ./cmd/almanac bank subjects private`. Its last line counts the errors and the warnings by rule;
  - `go run ./cmd/almanac bank lint [-rule giveaway,stale] [-summary] private` lists every problem by rule, with
    the question's id and what's wrong: what a content pass works through.

## The aims (the owner's rules)

- **Difficulty is the rubric's, not a quota.** Since 16 Nov 2026 there is no mix to aim for (it was 50/35/15): a
  question is labelled for what Bulgarian players know (below), and batches are written by the day's runway.
- **Kinds: 50% choice, 15% true-or-not, 10% number, 7.5% order, 7.5% match, 5% split, 5% clues**, in every category
  (`bank.TypeMix`), close to what the game draws (a run of ten has five choices, one of each other kind, and a split
  or clues), so that no kind runs out long before the others. `bank check` shows each category's kinds against it.
- **The bank grows by the day's runway** (the owner's rule since 15 Nov 2026, in place of "fully balanced, always"):
  the day spends its places at its own pace — one easy choice with a picture, one hard number, two hard choices, a
  medium order and match… a day — about three times faster for the hard places than for the easy ones. So
  `bank check` prints, for each place of a day, how many days from today it has questions for, counted as the day
  takes them: only the questions a day can still take (with `-used`, none the days played or
  drawn ahead have had; without it, the whole bank, which overstates it), never a dated one (it waits for its date;
  those are counted apart), never one due for review, and for the hard number only the estimates. The questions about
  Bulgaria have their own line (a day takes three). The days are drawn 90 days ahead (`play.Ahead`), and only while
  every place has a question that fits it: a place that runs out stops them. **Every batch writes for the shortest
  runway first**, and no place may stay under 150 days (it warns: 90 drawn ahead, 60 to write the batch). Never by
  filler (an "easy number" whose answer is 5 is a choice in disguise; an honest hard question beats a forced place). A retired question is still replaced in its place in the same commit.
- **The categories about the same size:** within 2% of the mean (`bank.SizeSlack`; `bank check` fails past it). No
  topic outweighs another, so a batch adds about as many to every category, and never to one that is ahead while
  another is behind.
- **Every question has a fact** („Знаеше ли?“), **the date it was added** and **the date it last changed**
  (`added`, `updated`, both YYYY-MM-DD). The checker refuses a question added since `RulesFrom` (2026-11-14)
  without them.
- Grow by adding: the balance report counts what it takes without dropping anything.
- **Never retire to make room** (the owner's rule, 2026-11-15). A question is retired only for a fault of its own:
  wrong, stale, weak, or a near-duplicate that gives another away. A batch that adds to some places (say, 250 easy
  choices with pictures) keeps the balance by writing for the other places, never by retiring good questions.

## The rules code checks

`bank check` judges these on every live question (`internal/bank/rules.go` lists them; `bank lint` shows each one's
findings). **A question added since `bank.StrictFrom` (2026-11-17) must pass all of them: a finding is an error and
the bank isn't played** (`bank add` refuses the batch). Older questions are warned of until a content pass fixes
them. A finding about two questions is an error if either is new. The *hints* only ever warn: they are right often
enough to be worth a look, not always.

| Rule | What it holds |
| --- | --- |
| `ending` | A question ends in „?“ or „:“; a true-or-not statement and a clue end in a period |
| `address` | „ти“ to one player: „Подреди“, never „Подредете“ |
| `fact` | One or two sentences, ending in a period; never „Интересно е, че…“ |
| `typography` | „…“ quotes in pairs (never "…" or «…»); `bank fmt` sets the rest: „…“ for three dots, a spaced dash —, a no-break space before „г.“ |
| `language` | None of the Russian words or loanwords in `language.json` |
| `spelling` | A name spelled as `names.json` says (Чингис хан, НАСА, Sony, „Дисни“, Ferrari, Нидерландия, олимпийските игри mid-sentence); a quoted title keeps its own spelling |
| `stale` | Wording that can stop being true has `reviewBy`: „към 2026 г.“, „все още“, „в момента“, „понастоящем“, the oldest still „действащ“, „държи рекорда“, „рекордьор“, „досега“ |
| `estimate` | A number question is an estimate: a year, or a quantity of more than 20 of its steps (6,5 млн. on a step of 0,1 is 65). A small count, a phone number, a place in a row is a choice |
| `tolerance` | The tolerance follows the formula (below), within half again either way |
| `order-gap` | An order's measured values (м, км², кг, жители, %, …: `measured` in order.go) stand 10% apart; exact ones (years, counts, coordinates) only differ |
| `options` | No option stands out by its form: only the answer with a regnal numeral (Симеон I), only the answer in Latin or in Cyrillic letters (bTV among БНТ, Нова), quotes on some options only |
| `long-answer` (hint) | The answer isn't half again as long as every wrong option and 10 letters longer |
| `answer-word` | No clue, and no question text, shares a word with the answer that no wrong option has („Кой е този водопад?“ — „Ниагарският водопад“; „френски лекари“ — „Лекари без граници“) |
| `dated` | A question for a day of every year (`on`: "MM-DD") says the date in its fact („На 3 март 1878 г. …“) |
| `decoy` | A match has a decoy |
| `giveaway` | No question shows a value another asks (a number's answer, a year a choice asks, an order's values) next to the same subject: in its text, options, items, clues, fact or reveal. Judged by the value and the rare words around it |
| `pair-giveaway` (hint) | No question shows both sides of a medium or hard match's pair within four words („Кучето Лайка“ for Лайка — Куче) |
| `shared-items` | Two orders share no two items with the same values, nor three items in the same order (one's reveal orders the other); two matches share no pair |
| `same-identity` | A "who or what is this" answer (a picture choice, clues) is asked once |

**A true exception** (a proverb to finish ends without „?“; a question about the word „таг“ itself) goes into the
bank's `waivers.json`, with its reason: `[{"id": "gen-085", "rule": "ending", "why": "поговорка за довършване"}]`.
`bank check` refuses a waiver for a question or a rule that doesn't exist, and warns of one that waives nothing.
**A new spelling to keep one way** goes into `names.json` (`{"use": "НАСА", "not": ["NASA"], "except": [...]}`),
in the game's repo, with a pull request.

## Difficulty: the rubric

Difficulty is gameplay, not decoration: a run goes from easy to hard, a topic run follows how well a player knows the
topic, Роял's rounds are easy, medium and hard. So every label means the same thing, by these rules, for players in
Bulgaria (not for the writer).

| | Who gets it | What it asks | The wrong options |
| --- | --- | --- | --- |
| **easy** | three of four adults, with no interest in the topic | what school to the 7th grade, everyday life, the news or a famous name gives everyone: national holidays and symbols, famous people, places and works, a round famous number | clearly of another kind or era: someone who knows the topic a little gets it |
| **medium** | about one in two: a well-read person, someone with a passing interest | high-school level, or a known fact taken one step further: the year of a major event, the author of a known (not the best-known) work, the capital of a mid-sized country | plausible, of the same kind; knowing the answer is needed, not just the topic |
| **hard** | one in four or fewer: an enthusiast | a detail: a lesser event's year, a secondary work, a record, a term, a smaller place | close to each other: only knowing it exactly gets it |

By kind:

- **Choice:** the options decide as much as the question. Close options make the same question harder; reword or
  change them rather than mislabel.
- **True or not:** easy is a famous fact stated plainly; hard is a plausible detail (true or false) that only an
  enthusiast can tell. Never hard by a trick of wording.
- **Number:** easy is a number everyone has met (1878, the height of Мусала); hard is a figure only an enthusiast
  can place. The tolerance doesn't follow the label: it is one formula at every difficulty (see the format).
- **Order:** easy has familiar things with values far apart (centuries); hard has values close together, or
  unfamiliar things.
- **Clues:** the label is for the first clue's answer only if the last clue makes it easy: easy is a famous answer
  whose last clue gives it to anyone; hard is one whose last clue still needs knowing the topic.
- **Split:** easy groups are what most people tell apart already (a mammal or not); hard ones need the detail
  (Ботев or Вазов by a lesser poem), with items that look alike across the groups.
- **Match:** easy pairs are what most people associate already; hard ones need specific knowledge, with lefts (or
  rights) alike. The decoy sets the difficulty too: a far one for easy, a close one for hard.
- **A picture** makes a question easier only if it shows the answer's look to people who'd recognise it.

Check the label against the answers once a question has `play.CalibrateFrom` (30) of them:
`DB_PATH=… almanac bank calibrate private` (on the server: as the almanac user) lists every question whose
label disagrees with what players knew, above chance: easy from 65%, medium from 35%, hard below. Judge each again
by the rubric; the answers usually win.

## The format

Every question is one JSON object in its category's file:

| Field                | What                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `id`                 | The category's prefix and a number (`his-412`). Next free number; never reuse or change one |
| `type`               | `choice`, `number`, `order`, `truefalse`, `match`, `split` or `clues`                    |
| `difficulty`         | `easy`, `medium` or `hard`                                                               |
| `text`               | The question: at most 160 characters (60 with a picture), ending in „?“ or „:“           |
| `fact`               | One or two sentences, at most 200 characters (see below)                                 |
| `added`, `updated`   | The day it joined the bank; the day it last changed at all                               |
| `changed`            | The day what it asks last changed (text, answer, options, items, pairs, clues, picture): players' answers from before it don't count in its crowd and calibration. Not for a fix to the fact alone |
| `sources`            | The pages (https://…) the answer and the fact were confirmed on: what the next check starts from. Never shown to players. Required for a question added since `SourcesFrom` (2026-11-17) |
| `checked`, `checkedBy` | When it was last checked against its sources, and by what: a process and its model (`"new-questions fable-5.2"`), or for older questions the bank commit that added or last changed it (`"bank 7bb2938"`: its message and report say how). Required since `SourcesFrom` |
| `reviewBy`           | For an answer that may stop being true (an office holder, a record): when to check it. From that day no game deals it (`bank check` warns, the server logs it) until it is checked and the date moved |
| `image`              | A picture (see below)                                                                    |
| `retired`            | `true`: never dealt again, kept for history and stats; with `retiredWhy` (`wrong`, `stale`, `weak`, `twin`, `giveaway`, `rule`) and `replacedBy` (the id that took its place). A question retired as `wrong` or `stale` also leaves what players learned (Моят Алманах) |
| `on`                 | The days it belongs to: `"03-03"` every year, `"2027-05-02"` that year only (Великден). On such a day it goes into the day's ten as „На този ден“; its fact says why the day |
| `bg`                 | `true` for a question about Bulgaria (people, places, history, culture, language, sport): every day has at least three |

By type:

- **`choice`:** `answer` and three `wrong`, each at most 60 characters. The game shows them in its own order. The
  options may be pictures (flags, paintings, animals, buildings): `pictures`, four images in the options' order (the
  answer's first), each with its own licence like a question's picture, and no `image` over the question. The text
  then names what to find („Кое е знамето на Литва?“, at most 60 characters); the names show only with the answer.
  Each `alt` describes its picture without naming it („Три хоризонтални ивици: жълта, зелена, червена“), and the four
  look alike enough that the picture, not a giveaway, decides.
- **`number`:** an **estimate** (the owner's rule, 16 Nov 2026): a year, or a quantity of more than 20 steps. A
  small count (4 evangelists, 7 times, the 15th of August) is a choice. `answer`, `unit` (empty for a year), `step`
  (1 for whole numbers; 0.1 for one decimal), `scale` (`linear`, or `log` across orders of magnitude) and `tolerance`
  (how far off scores nothing; on a log scale, a factor above 1). It's typed on a pad, and the player isn't told a
  range. Only a temperature (°C) may be below 0. **The tolerance is one formula** (`bank.Tolerance`), the same at
  every difficulty, so that a well-read guess scores about half (a guess half the tolerance off does):
  - a quantity, linear: 3/10 of the answer (15% off scores half; within 6% counts right);
  - a year: 3·∛(years since it), at least 3 (1990: 10; 1878: 16; 1519: 24; 681: 33);
  - a log scale: 3;
  - a temperature: by judgement (the formula has no proportion for it).

  `bank check` takes a tolerance within half again of the formula, and says the formula's figure when it isn't.
- **`order`:** four `items` (`text` at most 45 characters and an exact `value`), `direction` (`asc` or `desc`) and
  `unit`. The text says the direction.
- **`truefalse`:** the text is a statement ending with a period, and `answer` is `true` or `false`. Write about as
  many false ones as true, each false by one clear fact, not by a trick of wording. **A false statement's fact starts
  with what is true** („Монако граничи с Италия.“ — „Монако граничи по суша само с Франция…“), then the rest. 10
  seconds to answer.
- **`clues`:** „Подсказки“. The text asks what to name („Кой е този човек?“, „Коя е тази държава?“), three `clues`
  (each at most 110 characters, a sentence ending with a period), `answer` and three `wrong` like a choice. The clues
  go from the hardest to the easiest: the first one only an expert knows, the second narrows it to a well-read
  person, the third gives it to almost anyone who knows the topic at all. Every clue is true of the answer only, and
  none names it or gives it away by a word from it. The wrong options fit the first clue's kind (all people, all
  countries) and some of them fit a clue taken alone, so that guessing early costs. The clues come 10 seconds apart;
  an answer is worth all of its points on the first clue, 60% on the second, 30% on the third. 30 seconds.
- **`split`:** „Раздели“. The text asks the one question that sorts („Бозайник ли е животното?“, „Чия е
  творбата: на Ботев или на Вазов?“), `groups` are the two answers to it (each at most 24 characters, left first),
  and six `items` (`text` at most 45 characters, `group` 0 or 1), at least two in each group. Every item belongs to
  its group under every source, and to only that one: a pair of groups that leaves room for „both“ or „neither“
  („Европа или Азия?“ for Турция) is not a split. The game shows the items one by one in its own order. 30 seconds.
- **`match`:** the text says what to join („Свържи държавата със столицата ѝ:“), four `pairs` of `left` and
  `right`, and a `decoy`: a fifth right that fits no left, each at most 30 characters. Every left has exactly one
  right that fits, under every source, and the decoy fits none of them (check it as hard as an answer). The decoy is
  of the same kind as the rights and tempting: the city people take for the capital („Сидни“), a neighbour of the
  answer, a name from the same school. Without it, whoever knows three pairs gets the fourth for nothing. The
  checker refuses a match added since `bank.DecoysFrom` (2026-11-15) without one. 30 seconds.

## Writing a question

- **One right answer,** defensible under every reliable source. The wrong options are plausible and of the same
  kind and form as the answer (all cities, all years; no odd one out by length, quotes or wording).
- **Nothing gives the answer away:** not in the text, not in the picture, and not in another question or fact
  (games mix topics). Grep the bank for the answer and the key words before adding.
- **Nothing goes stale.** No „сегашният“, „последният“ or „най-новият“ unless pinned to a date („към 2026 г.“), and
  add `reviewBy` for anything that can change (the `stale` rule finds the wording that needs it).
- **No near-duplicates.** Grep the bank for the subject first. The checker only catches identical texts.
- **No subject everywhere.** A subject (Наполеон, „Титаник“, „Дисни“) stays under 1% of a category: past that, a
  player who plays daily meets it again and again. Write away from the subjects `bank subjects` marks with `*`, and
  never a second "who or what is this" question with an answer one already has (the `same-identity` rule): keep the
  better of the two and replace the other in its place. A day holds one question of each subject (same answer or quoted
  title) by itself.
- **Bulgarian, as the bank writes it:**
  - „…“ quotes, a spaced dash —, „г.“ after a year (`bank fmt` holds it to the year with a no-break space);
  - established spellings (Нидерландия, not Холандия), one way for one name: `names.json`;
  - text that speaks to the player says „ти“ and is gender-neutral.
- **Numbers:** something worth estimating (a year, or more than 20 steps) with one accepted value. Pin the source
  where sources differ („според измерването от 2020 г.“). The tolerance is the formula's.
- **Orders:** exact, sourced values in the same order under every source. Measurements that sources give
  differently (areas, lengths, populations, heights) need at least 10% between neighbours; exact values (years,
  dates) only need to be distinct and undisputed. The reveal shows every value, so none of them may be another
  question's answer, and no other question's text, options or fact may show a value an order or number question
  asks next to its subject („„Титаник“ (1997)“ when an order asks it); drop the year unless it is needed to tell
  the thing apart (a remake, a namesake).

## Writing the fact

- One or two sentences, ending with a period. Something true and surprising **about the answer** that the question
  didn't say: a cause, a consequence, a number that gives scale, or a misconception put right. Not the answer
  restated, and not „Интересно е, че…“.
- It must not answer another question in the bank: grep its names and numbers.
- Claim only what the sources claim, and keep their hedges („според преданието“, „около“).

## Pictures

- Free licences only (public domain, CC0, CC BY, CC BY-SA). Artworks only if the artist died 70 or more years ago.
  No film stills, posters, covers, logos, banknotes or screenshots. Portraits only of public figures.
- No legible text in the picture that names the answer.
- `alt` describes the picture without giving the answer. The credit and licence come from the file's page.

## Changing a question

- Set `updated` to today whenever anything changes. If what it asks changed (text, answer, options, items, pairs,
  clues, picture, tolerance), set `changed` to today too: the answers given before then stop counting.
- Change it in place when it still asks the same thing, better (a clearer wording, a fairer option). If it would ask
  something else (another subject or answer), retire it (`"retired": true`, `retiredWhy`, `replacedBy`) and add a new
  one with a new id: answers already given and stats point at the old one.
- Keep `sources` true: add the page a fix rests on, drop one that no longer supports it. A fix checked again against
  its sources sets `checked` and `checkedBy`.
- Don't touch a retired question except to read it.

## The workflow

**A new batch is `/new-questions`** (`.claude/skills/new-questions/`): it runs these steps with the plan from
`almanac bank plan` (what to write, for the day's shortest runway and the dates with the fewest questions, the same in
every topic), writers and independent checkers on fixed models, a cross-check over all topics, and `almanac bank add`
(all of the batch, or nothing). **Fixes by the rules are `/fix-questions`**: what `bank lint` flags (or a rule code can't check, judged by
selector), fixed a chunk at a time by a fixer and an independent checker, and added through `bank add`. A new rule is
a check in `internal/bank/rules.go` first, then a `/fix-questions` pass over what it flags: never a pass over the whole
bank. By hand, for a fix or a few questions:

1. **Find the gaps:** run `bank check` and read the day's runway and the balance report. Plan the batch from the
   shortest runway first (every place under 150 days before anything else), then the kinds a category lacks; about
   the same count in every category.
2. **Write** the questions into the category files, with the next free ids, `added` and `updated` set to today, and
   a fact on each.
3. **Verify independently.** Give a fresh agent the new questions and answers (not your reasoning). It checks each
   one against reliable sources: the marked answer is right, no other option is also right, nothing is outdated,
   the wording has one reading, the fact is true, and the difficulty fits the definitions. It reports OK, FIX or
   DROP, with evidence. Apply the fixes, and drop what it can't confirm.
4. **Check:** `bank fmt`, then `bank check`: no errors (every rule above holds for the new questions), the
   categories within 2% of each other's mean (it fails otherwise), and no place's runway shorter than before the
   batch.
5. **Commit in `private/`** (`git -C private …`), one commit per batch, its message listing the ids. On the server,
   `almanac-bank` takes the new questions without a restart.
6. **Tell the owner** what went in: a short list of question → answer, with the fact, so they can read it.

Agents doing this work never send personal data anywhere: no names or email addresses in search queries, URLs or
User-Agent headers.
