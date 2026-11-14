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
- The format and the checks are the code: `internal/bank` (one file per type, plus `check.go` and `balance.go`).
- The tools (from the repo root):
  - `go run ./cmd/almanac bank fmt private` writes the files in their one format; run it after every edit;
  - `go run ./cmd/almanac bank check private` checks everything the server checks before it plays a bank. It ends
    with the balance report: the difficulty and kind mix, facts and dates, and the full-balance grid. It **fails**
    while the bank isn't fully balanced (`-unbalanced` lets the small public sample pass).

## The aims (the owner's rules)

- **Difficulty: 50% easy, 35% medium, 15% hard,** in every category (`bank.Mix`), judged by the rubric below.
- **Kinds: 55% choice, 15% true-or-not, 10% number, 7.5% order, 7.5% match, 5% split** (once „Подсказки“ joins:
  50% choice and 5% of it), in every category (`bank.TypeMix`), close to what the game draws (a run of ten has five
  choices and one of each other kind), so that no kind runs out long before the others.
- **The bank must be fully balanced, always** (the owner's rule): every category the same size; in it, the kinds in
  their mix; and within each kind, the difficulties in theirs (a topic's true-or-not are 50% easy, 35% medium, 15%
  hard, like its choices). So every category has exactly the same count in every cell: as many hard number
  questions in music as in geography. `bank check` ends with the full grid — per category, kind and difficulty: `+n` to write, `−n`
  too many — and how many questions are out of place in all; it must be 0 before every commit, so a batch fills the
  same cells in every category, and a retired question is replaced in its cell in the same commit. Close a `+` by writing for that cell;
  a `−` by judging the questions again (move one to a neighbouring difficulty only where that's honest for
  Bulgarian players; what players get right shows how hard a question really is) or retiring the weakest.
- **Every category the same size.** No topic outweighs another, so a batch adds to every category, or closes the
  gaps that `bank check` reports, biggest first. Never add to a category that is ahead while another is behind.
- **Every question has a fact** („Знаеше ли?“), **the date it was added** and **the date it last changed**
  (`added`, `updated`, both YYYY-MM-DD). The checker refuses a question added since `RulesFrom` (2026-11-14)
  without them. Older questions get theirs as they're gone over.
- Grow by adding: the balance report counts what it takes without dropping anything.

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
- **Number:** easy is a number everyone has met (1878, 7 continents); hard is a precise figure. The tolerance
  follows: generous for easy, tight for hard.
- **Order:** easy has familiar things with values far apart (centuries); hard has values close together, or
  unfamiliar things.
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
| `type`               | `choice`, `number`, `order`, `truefalse`, `match` or `split`                             |
| `difficulty`         | `easy`, `medium` or `hard`                                                               |
| `text`               | The question: at most 160 characters (60 with a picture), ending in „?“ or „:“           |
| `fact`               | One or two sentences, at most 200 characters (see below)                                 |
| `added`, `updated`   | The day it joined the bank; the day it last changed                                      |
| `reviewBy`           | For an answer that may stop being true (an office holder, a record): when to check it    |
| `image`              | A picture (see below)                                                                    |
| `retired`            | `true`: never dealt again, kept for history and stats                                    |

By type:

- **`choice`:** `answer` and three `wrong`, each at most 60 characters. The game shows them in its own order.
- **`number`:** `answer`, `unit` (empty for a year), `step` (1 for whole numbers; 0.1 for one decimal), `scale`
  (`linear`, or `log` across orders of magnitude) and `tolerance` (how far off scores nothing; on a log scale, a
  factor above 1). It's typed on a pad, and the player isn't told a range. Only a temperature (°C) may be below 0.
- **`order`:** four `items` (`text` at most 45 characters and an exact `value`), `direction` (`asc` or `desc`) and
  `unit`. The text says the direction.
- **`truefalse`:** the text is a statement ending with a period, and `answer` is `true` or `false`. Write about as
  many false ones as true, each false by one clear fact, not by a trick of wording. 10 seconds to answer.
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
  add `reviewBy` for anything that can change.
- **No near-duplicates.** Grep the bank for the subject first. The checker only catches identical texts.
- **Bulgarian, as the bank writes it:**
  - „…“ quotes, a spaced dash —, „г.“ after a year;
  - established spellings (Нидерландия, not Холандия);
  - text that speaks to the player is gender-neutral.
- **Numbers:** something worth estimating with one accepted value. Pin the source where sources differ
  („според измерването от 2020 г.“). The tolerance is set so that a well-read guess still scores about half.
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

- Set `updated` to today whenever the text, answer, options, fact or picture changes.
- If a change alters what the question asks, retire it (`"retired": true`) and add a new one with a new id: answers
  already given and stats point at the old one.
- Don't touch a retired question except to read it.

## The workflow

1. **Find the gaps:** run `bank check` and read the balance report. Plan the batch from the gaps: categories and
   difficulties, biggest first.
2. **Write** the questions into the category files, with the next free ids, `added` and `updated` set to today, and
   a fact on each.
3. **Verify independently.** Give a fresh agent the new questions and answers (not your reasoning). It checks each
   one against reliable sources: the marked answer is right, no other option is also right, nothing is outdated,
   the wording has one reading, the fact is true, and the difficulty fits the definitions. It reports OK, FIX or
   DROP, with evidence. Apply the fixes, and drop what it can't confirm.
4. **Check:** `bank fmt`, then `bank check`, with no errors and full balance (it fails otherwise).
5. **Commit in `private/`** (`git -C private …`), one commit per batch, its message listing the ids. On the server,
   `almanac-bank` takes the new questions without a restart.
6. **Tell the owner** what went in: a short list of question → answer, with the fact, so they can read it.

Agents doing this work never send personal data anywhere: no names or email addresses in search queries, URLs or
User-Agent headers.
