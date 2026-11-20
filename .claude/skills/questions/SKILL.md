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
  - `almanac bank days [-n 30] [-from YYYY-MM-DD] [-json]`, on the server, prints the issues to come: the next N days'
    tens as the game has drawn them (`play.Ahead`, 90 days ahead), each question with its answer, options, fact, what
    lint finds and a subject that came back within a week. It only reads the database (`-json`: the days and their ids
    alone, for a work list). Run it as the game's user with its settings, as `bank used`:
    `ssh -i ~/.ssh/hetzner -o BatchMode=yes root@2.31.121.12 systemd-run --pipe --wait -p User=almanac -p
    EnvironmentFile=/etc/almanac/env /usr/local/bin/almanac bank days -n 30 > <work>/days.txt` (it reads the bank the
    game plays, `BANK_DIR`); it is what the weekly pre-check reads (below);
  - `go run ./cmd/almanac bank plan [-n N] [-json] [-used file] private` plans a batch of N a topic: the cells to
    write (the day's shortest runway first, at most a third of the batch in one place), how many about Bulgaria (30%,
    per cell: `bg`), the dates with the fewest questions left, the ids and the subjects to avoid;
  - `go run ./cmd/almanac bank add [-check] [-checked-by P] <batch> private` puts a batch into the bank: new
    questions, changes to existing ones and retirements (`<category>.json` files, `images/`, maybe `retire.json`:
    `[{"id", "why", "by"}]`). It is the one checked way to change the bank, for a fix of one question and a content
    pass over thousands alike:
    - an id the bank doesn't have is a **new** question: the next free number of its category;
    - an id the bank has (live, in that category's file) is a **change**: the batch's object replaces the question
      whole, in its place. It keeps `added` as the bank has it, sets `updated` to today, and sets `changed` to today
      if what it asks changed (its text, answer, options, items, pairs, decoy, clues, groups, picture, tolerance,
      unit, step, scale or direction, against the bank's version); if only the fact, the day's line or the labels
      (difficulty, `on`, `bg`, `sources`, `reviewBy`, a picture's credit) changed, `changed` stays as it was. A
      retired question isn't changed (a new one takes its place), nor one the batch also retires; one the same as
      the bank's is left out of the batch;
    - all of it holds and the bank with it in loads with no errors, or nothing is written. It reports how many
      questions it added, changed and retired, and the warnings left on them. `-check` only checks; `-checked-by`
      marks the new and changed questions checked today by that process (where the batch doesn't say otherwise);
  - `go run ./cmd/almanac bank check [-used file] [-live dir] private` checks everything the server checks before it plays a
    bank: the format and **every rule below that code can judge**. It prints every error, then the balance report:
    the difficulty and kind mix, facts, dates and sources (how many have them, and the rest by kind), each
    category's kinds against their share, **the day's runway** — how many days from today each place of a day has
    questions for, and the day it runs out on — and **the dates' supply** („На този ден“: the dates of the year
    ahead with fewer than two questions no day has had), and **the national days** (`bank.NationalDays`: each with
    how many questions about Bulgaria a day can still deal: none a day has had, with `-used`). It **fails** on an
    error, while a category is more than 2% off the mean size (`bank.SizeSlack`), and while a national day has no
    question about Bulgaria left (`-sample` lets the small public sample pass these two; with `-live`, the bank the
    game plays, as `almanac-bank` runs it, only a national day this bank emptied fails, one empty there too is warned
    of, so an urgent fix is never held up by it), and **warns** of every place under 150 days (`play.RunwayWarn`: the 90 days
    drawn ahead and 60 to write) and of every thin date. Then **the subjects that come back** (listed, never failed): the answers and names
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
  those are counted apart), never one due for review, and for the hard number only the estimates (never an unwaived count of a list: `countable`). The questions about
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
- **Every question has its sources,** in time: a question added since `SourcesFrom` (2026-11-17) or changed since
  `TouchedFrom` (2026-11-19) has the pages it was checked on (`bank check` refuses it without). The older ones get
  theirs in a sourcing pass (`/fix-questions`), in this order: the numbers and orders (their reveal shows every value
  as fact), the dated questions and those about Bulgaria, then the rest. `bank check` counts what's left, by kind.
- Grow by adding: the balance report counts what it takes without dropping anything.
- **Never retire to make room** (the owner's rule, 2026-11-15). A question is retired only for a fault of its own:
  wrong, stale, weak, or a near-duplicate that gives another away. A batch that adds to some places (say, 250 easy
  choices with pictures) keeps the balance by writing for the other places, never by retiring good questions.

## The rules code checks

`bank check` judges these on every live question (`internal/bank/rules.go` lists them; `bank lint` shows each one's
findings). **A question added since `bank.StrictFrom` (2026-11-17) must pass all of them: a finding is an error and
the bank isn't played** (`bank add` refuses the batch); a rule added since is an error from its own day (the days'
audit's, marked † below: from `bank.AuditFrom`, 2026-11-21). Older questions are warned of until a content pass
fixes them. A finding about two questions is an error if either is new. The *hints* only ever warn: they are right often
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
| `present` † | A career, a show or an office told as now, in a line with no time of its own, has `reviewBy` or a year: „Бие се в UFC“, „шоуто се записва всяка вечер“, „е председател на фондацията“. A line with a year, „когато“, a span (колко години), an order (първият) or a life that ended reads as the past |
| `estimate` | A number question is an estimate: a year, or a quantity of more than 20 of its steps (6,5 млн. on a step of 0,1 is 65). A small count, a phone number, a place in a row is a choice |
| `countable` † | A number doesn't count the items of a list (a composer's works, awards, a text's articles or clauses, seats, spectators, goals, points, the times something was done: `listWords` in estimate.go): nobody has counted them, so it's a guess. Ask it as a choice, or ask what can be placed; a true anchor (a famous total: the Bible's 66 books) is a waiver whose `why` names it. The day's hard number never takes one unwaived |
| `anchor` (hint) | An estimate counts what a well-read player can place, not an archive's count: a series' episodes, a hall's seats, a council's members, a dictionary's words, prize money, a fine |
| `tolerance` | The tolerance follows the formula (below), within half again either way |
| `offset-scale` † | On a scale with no zero of its own (°C, an angle or a latitude in °, points, a rating such as Elo) the tolerance is judged: under 1/5 of the answer, never the formula's 3/10 (Topalov's Elo of 2 816 with 840 is a gift); linear |
| `own-number` † | A number question's text, and a name it quotes, shows no number (in figures or words) within the tolerance of its answer: „Стоте дни“ asked as 110 with 33 answers itself |
| `order-gap` | An order's measured values (м, км², кг, жители, %, …: `measured` in order.go) stand 10% apart; exact ones (years, counts, coordinates) only differ |
| `options` | No option stands out by its form: only the answer with a regnal numeral (Симеон I), only the answer in Latin or in Cyrillic letters (bTV among БНТ, Нова), quotes on some options only |
| `long-answer` (hint) | The answer isn't half again as long as every wrong option and 10 letters longer |
| `answer-word` | No clue, and no question text, shares a word with the answer that no wrong option has („Кой е този водопад?“ — „Ниагарският водопад“; „френски лекари“ — „Лекари без граници“) |
| `dated` | A question for a day (`on`) has its day's line (`day`), ending in a period, and the line names the date („На 3 март 1878 г. …“; a moving feast's names the feast). One whose text names its date may go without it |
| `own-date` | A true-or-not for a day names no date and isn't about the day itself, nor has a choice for a day its date for the answer: dealt on it under „На този ден“, „3 юни е Световният ден на велосипеда.“ answers itself, and so do its mirror („…празнува Коледа на 7 януари.“ on 25 December) and „…са родени в един и същи ден.“ |
| `decoy` | A match has a decoy |
| `giveaway` | No question shows a value another asks (a number's answer, a year a choice asks, an order's values) next to the same subject: in its text, options, items, clues, fact, day's line or reveal. Judged by the value and the rare words around it; a small or round value (28) only with its unit („28 килограма“ for an answer in кг) |
| `answer-giveaway` (hint) | No question shows a choice's or clues' answer as true (text, clue, fact, day's line, item, pair) in a line that, with its question's text, shares rare words with the asking question's subject („Ариел“ in „бащата на русалката Ариел в анимацията на „Дисни““) |
| `pair-giveaway` (hint) | No question shows both sides of a medium or hard match's pair within four words („Кучето Лайка“ for Лайка — Куче) |
| `shared-items` | Two orders share no two items with the same values, nor three items in the same order (one's reveal orders the other); two matches share no pair |
| `length` (hint) | A question reads no longer than its kind's usual allows: `bank.Reading` (the letters and digits it shows, a picture as 24) past the kind's third quartile by twice the spread of its middle half. The clock gives time by length (`play.Limit`), so a long one runs long for everyone: say it shorter, drop a clause the answer doesn't need |
| `same-identity` | A "who or what is this" answer (a picture choice, clues) is asked once |
| `twin` † | Two choices (or clues) over one set of options — three of four shared, each offered by few questions — ask one thing twice: the same answer, or mirrored (Карлоф or Лугоши, each the other's wrong option). Give one other options, or keep the better one |

**A true exception** (a proverb to finish ends without „?“; a question about the word „таг“ itself) goes into the
bank's `waivers.json`, with its reason: `[{"id": "gen-085", "rule": "ending", "why": "поговорка за довършване"}]`.
`bank check` refuses a waiver for a question or a rule that doesn't exist, and warns of one that waives nothing.
**A new spelling to keep one way** goes into `names.json` (`{"use": "НАСА", "not": ["NASA"], "except": [...]}`),
in the game's repo, with a pull request.

## Difficulty: the rubric

Difficulty is gameplay, not decoration: a run goes from easy to hard, a topic run follows how well a player knows the
topic. So every label means the same thing, by these rules, for players in
Bulgaria (not for the writer).

| | Who gets it | What it asks | The wrong options |
| --- | --- | --- | --- |
| **easy** | three of four adults, with no interest in the topic | what school to the 7th grade, everyday life, the news or a famous name gives everyone: national holidays and symbols, famous people, places and works, a round famous number | clearly of another kind or era: someone who knows the topic a little gets it |
| **medium** | about one in two: a well-read person, someone with a passing interest | high-school level, or a known fact taken one step further: the year of a major event, the author of a known (not the best-known) work, the capital of a mid-sized country | plausible, of the same kind; knowing the answer is needed, not just the topic |
| **hard** | one in four or fewer: an enthusiast | a detail: a lesser event's year, a secondary work, a record, a term, a smaller place | close to each other: only knowing it exactly gets it |

By kind:

- **Choice:** the options decide as much as the question. Close options make the same question harder; reword or
  change them rather than mislabel.
- **True or not:** easy is a common misconception put plainly, true or false, that three of four adults still get
  right („Мълнията не удря два пъти на едно място.“), never a truism nobody can miss („Слънцето е звезда.“: a free
  point teaches nothing; the days' audit found a third of the easy ones were). Hard is a plausible detail (true or
  false) that only an enthusiast can tell. Never hard by a trick of wording.
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
| `fact`               | One or two sentences, at most 140 characters for a question added since `ShortFactsFrom` (2026-11-19: on a phone it shows whole, under the answer), 200 for the older ones (see below) |
| `added`, `updated`   | The day it joined the bank; the day it last changed at all                               |
| `changed`            | The day what it asks last changed (text, answer, options, items, pairs, clues, picture): players' answers from before it don't count in its crowd and calibration. Not for a fix to the fact alone |
| `sources`            | The pages (https://…) the answer and the fact were confirmed on: what the next check starts from. Never shown to players. Required for a question added since `SourcesFrom` (2026-11-17), or changed since `TouchedFrom` (2026-11-19) |
| `checked`, `checkedBy` | When it was last checked against its sources, and by what: a process and its model (`"new-questions fable-5.2"`), or for older questions the bank commit that added or last changed it (`"bank 7bb2938"`: its message and report say how). Required with `sources` |
| `reviewBy`           | For an answer that may stop being true (an office holder, a record): when to check it. From that day no game deals it (`bank check` warns, the server logs it) until it is checked and the date moved |
| `image`              | A picture (see below)                                                                    |
| `retired`            | `true`: never dealt again, kept for history and stats; with `retiredWhy` (`wrong`, `stale`, `weak`, `twin`, `giveaway`, `rule`) and `replacedBy` (the id that took its place). A question retired as `wrong` or `stale` also leaves what players learned (Моят Алманах) |
| `on`                 | The days it belongs to: `"03-03"` every year, `"2027-05-02"` that year only (Великден). On such a day it goes into the day's ten as „На този ден“ |
| `day`                | With `on`, required (unless the text itself names the date it asks about): one short line (at most 100 characters, ending in a period) saying what happened on that day and naming the date: „На 16 декември 1982 г. умира Колин Чапман.“ The player reads it with the answer, only when the question is dealt on its date (never before answering: it could give the answer away; never in a topic's game). See „A question for a day“ below |
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
  - an offset scale (°C, °, points, a rating): by judgement, under 1/5 of the answer (the formula's proportion means
    nothing where the scale's zero is arbitrary).

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
- **No near-duplicates.** Grep the bank for the subject first. The checker catches identical texts, and the same
  options asked twice (`twin`); the rest is yours.
- **No subject everywhere.** A subject (Наполеон, „Титаник“, „Дисни“) stays under 1% of a category: past that, a
  player who plays daily meets it again and again. Write away from the subjects `bank subjects` marks with `*`, and
  never a second "who or what is this" question with an answer one already has (the `same-identity` rule): keep the
  better of the two and replace the other in its place. A day holds one question of each subject (same answer or quoted
  title) by itself, and, where the bank lets it, none the week before had (`play.Recent`).
- **Bulgarian, as the bank writes it:**
  - „…“ quotes, a spaced dash —, „г.“ after a year (`bank fmt` holds it to the year with a no-break space);
  - established spellings (Нидерландия, not Холандия), one way for one name: `names.json`;
  - text that speaks to the player says „ти“ and is gender-neutral.
- **Numbers:** something worth estimating (a year, or more than 20 steps) with one accepted value. Pin the source
  where sources differ („според измерването от 2020 г.“). The tolerance is the formula's.
- **An estimate a player can place.** The day ends on a hard quantity (the draw puts it last), the moment players
  remember most, so a number needs an **anchor** a well-read player has, and **its text or its fact names it**
  („…висок колкото 30-етажна сграда“, „…на около 2 000 км от Москва“), so that the reveal places the answer against
  something the player knows (a height, a length, a distance, an age, a duration, a famous total, a
  size against something known) and a reveal that teaches something. A count kept only in an archive or a document
  (a series' episodes, a hall's seats, a council's members, a dictionary's words, prize money, a fine, the species in
  a park's management plan, the walkers on one march) is a guess, not an estimate: the `anchor` hint flags the
  common ones and the `countable` rule the counts of a list; the checker judges the rest. Ask such a subject as a choice, or ask what about it can be placed.
- **It belongs under its topic.** A day takes one question a topic: a question filed under the wrong one („Правец е
  родното място на кой държавен ръководител?“ under technology, for the computers) takes that topic's place with
  another's question. Ask of each: would a player of this topic expect it here?
- **Orders:** exact, sourced values in the same order under every source. Measurements that sources give
  differently (areas, lengths, populations, heights) need at least 10% between neighbours; exact values (years,
  dates) only need to be distinct and undisputed. The reveal shows every value, so none of them may be another
  question's answer, and no other question's text, options or fact may show a value an order or number question
  asks next to its subject („„Титаник“ (1997)“ when an order asks it); drop the year unless it is needed to tell
  the thing apart (a remake, a namesake).

## Writing the fact

- One or two sentences, ending with a period, at most 140 characters (about 130 is the aim: on a phone the fact
  shows under the answer, with the day's line on a dated question). Something true and surprising **about the
  answer** that the question didn't say: a cause, a consequence, a number that gives scale, or a misconception put
  right. Not the answer restated, not a fact about something else the question merely mentions (a camel's nostrils
  under „Има ли животното рога?“), and not „Интересно е, че…“.
- It must not answer another question in the bank: grep its names and numbers.
- Claim only what the sources claim, and keep their hedges („според преданието“, „около“).

## A question for a day

A question with `on` is dealt on its date as „На този ден“ (its topic and „На този ден“ over it), and its `day` line
shows with the answer, over the fact: the player learns why the day. (The owner's decision B, 16 Nov 2026.)

- **The `day` line** says what happened on that day and names the date, in one short sentence (at most 100
  characters, ending in a period): „На 16 декември 1982 г. умира Колин Чапман.“, „На 3 март 1878 г. е подписан
  Санстефанският мирен договор.“ A moving feast's line (`on` with years) names the feast and what it marks instead
  of a date („На Великден християните празнуват Възкресението Христово.“). It shows only after the answer, so it may
  name what the question asks; it never shows in a topic's game.
- **The text names the date only when the date is what's asked.** Not „Колин Чапман, починал на 16 декември
  1982 г., основава коя марка…“, but „Кой основава марката „Лотус“?“: the day's line says the date. A question that
  does ask about its date („Коя държава празнува националния си ден на 1 юли?“) may go without a day's line, and
  should unless the line tells more than the text („На 1 юли 1867 г. е създадена Канадската конфедерация.“ does; „На
  14 март е Денят на числото π.“ after „Кое число празнуват математиците на 14 март?“ only takes a phone's screen).
- **A true-or-not never names a date** (the `own-date` rule): dealt on it, „3 юни е Световният ден на
  велосипеда.“ is true by construction, and „…празнува Коледа на 7 януари.“ on 25 December false by it; „…са родени
  в един и същи ден.“ on that day answers itself too. State something about the day that the date doesn't give away:
  who declared it, what it marks, how it's kept.
- **The fact says something new,** not the date again: the day's line has said it. „Чапман умира на 16 декември.“
  is a wasted fact.
- Bulgarian events before 1916: the New Style date Bulgaria marks today.
- **A date takes one question a year, and waits for it.** A day never deals a question twice, so a date with one
  question is blank the year after: `bank check` warns of every date of the year ahead with fewer than two that no day
  has had, and batches write for the thinnest dates (`bank plan` gives them). Until a day deals it, a dated question
  is kept out of every other game (topic games, duels: `play.waiting`), so it isn't spent early.
- **The national days come first** (`bank.NationalDays`: the Liberation, the Unification, Independence, Левски's
  birth and death, Ботев, the 24th of May, the Enlighteners, Гергьовден, the students' day, the feasts): each has
  questions about Bulgaria on its own theme, two or three of them (`bank check` fails while one has none). A date's
  questions prefer a story with a Bulgarian or a human angle to a template („Коя държава празнува на … ?“, „Какво
  отбелязва ООН на …?“): templates stay under a tenth of the dated questions, and never a national day's.

## The weekly pre-check

The days are drawn 90 days ahead, so every issue can be read before anyone plays it. Once a week (a session's job,
never the owner's), the next 14–30 days are read and fixed through `/fix-questions` with `--judge days` (its „The
pre-check“): `bank days -n 30 -json` from the server gives the work list, `bank days -n 30` the issues to read whole.
Each question is judged by everything above, not only what lint finds: a wrong or stale answer or fact, a truism among
the easy true-or-not, a closing number without its anchor, a twin or a subject again within the week, a question
filed under the wrong topic. A fix changes the question in place, so its day keeps it; a retired one leaves its day,
which the server draws again.

## Pictures

- Free licences only (public domain, CC0, CC BY, CC BY-SA). Artworks only if the artist died 70 or more years ago.
  No film stills, posters, covers, logos, banknotes or screenshots. Portraits only of public figures.
- No legible text in the picture that names the answer.
- `alt` describes the picture without giving the answer. The credit and licence come from the file's page.

## Changing a question

- Change it through `bank add`: the changed questions, whole, in a batch's `<category>.json` (see the tools above),
  never by hand in the bank's files; it checks the dates below for you.
- Set `updated` to today whenever anything changes. If what it asks changed (text, answer, options, items, pairs,
  decoy, clues, groups, picture, tolerance, unit, step, scale, direction), set `changed` to today too: the answers
  given before then stop counting. A fix to the fact, the day's line or the labels leaves `changed` as it was.
- Change it in place when it still asks the same thing, better (a clearer wording, a fairer option). If it would ask
  something else (another subject or answer), retire it (`"retired": true`, `retiredWhy`, `replacedBy`) and add a new
  one with a new id: answers already given and stats point at the old one.
- Keep `sources` true: add the page a fix rests on, drop one that no longer supports it. A fix checked again against
  its sources sets `checked` and `checkedBy`. A question without sources gets them with any change, a label's
  included (`TouchedFrom`): the check you make for the change is the check they record.
- Don't touch a retired question except to read it.
- Never take a question out of the bank: retire it. The server refuses a bank that drops an id (`bank.Dropped`).
- A question of today's ten changed in what it asks, or retired as `wrong` or `stale`, during its day counts for
  nobody that day (`internal/play/day.go`): everyone's day is then of the other nine. Fix it all the same; a polish
  that can wait (a clearer wording) waits for tomorrow.

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
2. **Write** the questions into a batch's category files (new ones with the next free ids, `added` and `updated` set
   to today, and a fact on each; changed ones whole, with their own ids), and put it in with `bank add` (`-check`
   first).
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
