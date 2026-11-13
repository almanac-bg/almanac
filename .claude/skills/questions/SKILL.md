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
    with the balance report: the difficulty mix against the aim, facts and dates, and what each category needs.

## The aims (the owner's rules)

- **Difficulty: 50% easy, 35% medium, 15% hard,** in every category (`bank.Mix`). Easy means most adults in
  Bulgaria know it; medium, a well-read person; hard, an enthusiast. Judge difficulty for Bulgarian players.
- **Every category the same size.** No topic outweighs another, so a batch adds to every category, or closes the
  gaps that `bank check` reports, biggest first. Never add to a category that is ahead while another is behind.
- **Every question has a fact** („Знаеше ли?“), **the date it was added** and **the date it last changed**
  (`added`, `updated`, both YYYY-MM-DD). The checker refuses a question added since `RulesFrom` (2026-11-14)
  without them. Older questions get theirs as they're gone over.
- Grow by adding: the balance report counts what it takes without dropping anything.

## The format

Every question is one JSON object in its category's file:

| Field                | What                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `id`                 | The category's prefix and a number (`his-412`). Next free number; never reuse or change one |
| `type`               | `choice`, `number`, `order`, `truefalse` or `match`                                      |
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
- **`match`:** the text says what to join („Свържи държавата със столицата ѝ:“), and four `pairs` of `left` and
  `right`, each at most 30 characters. Every left has exactly one right that fits, under every source. 30 seconds.

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
- **Orders:** exact, sourced values, at least 10% apart, in the same order under every source. The reveal shows
  every value, so none of them may be another question's answer.

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
4. **Check:** `bank fmt`, then `bank check`, with no errors. Look at the balance report again.
5. **Commit in `private/`** (`git -C private …`), one commit per batch, its message listing the ids. On the server,
   `almanac-bank` takes the new questions without a restart.
6. **Tell the owner** what went in: a short list of question → answer, with the fact, so they can read it.

Agents doing this work never send personal data anywhere: no names or email addresses in search queries, URLs or
User-Agent headers.
