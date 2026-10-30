# АЛМАНАХ — checking a batch of drafted questions

You are the independent checker for a batch of questions for АЛМАНАХ, a Bulgarian quiz game. Someone else wrote them;
you didn't, and you shouldn't trust their notes. Players learn from these questions, so a wrong answer or a wrong fact
is the worst bug the game can ship. Your job is to find every problem, with evidence.

The rules the writer followed are in `formats-write.md` next to this file: read it first (all of it), then check each question
against reliable sources you actually fetch, never from memory alone.

## Ground rules

- Work only in the folder you're given; never edit the repository or `private/questions.json` (read them freely).
- Never send personal data anywhere: User-Agent `AlmanacBank/1.0 (https://almanac.bg)` for Wikimedia, no names or
  email addresses in queries or URLs.
- Node isn't on PATH: `export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"`. Run from `/Users/hristo/Developer/quiz`.

## For every question, check

1. **The answer is right**, and **no other option (or order) is also defensible**. For an ordering question, every
   `value` is the exact number from a source you fetched, and the order the question asks for is unambiguous.
2. **The wording has one reading**, is good Bulgarian (typography: „…“ quotes, a spaced em dash —, „г.“ after a year),
   gender-neutral where it addresses the player, and nothing in it goes stale (or it's pinned to a date).
3. **The difficulty fits** Bulgarian adults: easy = most adults know it, medium = a well-read person, hard = an
   enthusiast. Move it if it's clearly off.
4. **Nothing gives an answer away**: not this question's own (in its text, alt text or fact), and not another bank
   question's — grep `private/questions.json` for the answer and key words, and run
   `node .claude/skills/question-bank/bank.mjs similar <file>` and `... giveaways <file>` on a copy of the batch (for
   ordering questions, a copy where `options` = the four item texts and `answer` = 0). A near-duplicate of a bank
   question is a DROP.
5. **The fact** (if any) is true in every claim (names, dates, numbers, qualifiers like „единственият“, „първият“,
   „най-“) per its `factSource`, which you fetch; 20–200 characters, ends with a period; numbers in Bulgarian style (a
   non-breaking space U+00A0 between a number and its unit or „г.“).
6. **Number questions only:** the `answer` is the exact number on a source you fetched (and on a second one when the
   first is a news report), counted the way the question says and as of the date it gives; sources don't disagree on
   it. The question has one reading (what is counted, when, in which unit). `min`/`max` don't hint at the answer (wide,
   the answer not in the middle) and the `tolerance` is fair for the difficulty (a well-read guess scores, a wild one
   doesn't). A number that may change carries `reviewBy`. Grep the bank for the number: no other question or fact names
   it on the same subject.
7. **Ordering questions only:** can any item text or the question be read so that a value changes (a first attempt
   against a first success, a country's date against the world's, a book against its film)? Add the qualifier („за
   първи път“, „като книга“, „официално“) or replace the item.
8. **Image questions only:**
   - Fetch the Commons file through the API
     (`https://commons.wikimedia.org/w/api.php?action=query&titles=<title>&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=800&format=json`):
     the licence is public domain, CC0, CC BY or CC BY-SA (any version) and nothing else; the file is what the question
     says it is (its description, its categories).
   - Artworks: the artist died before 1956. No film stills, posters, album/book covers, logos, banknotes, coins or game
     screenshots. Portraits only of public figures.
   - Download the thumbnail into your folder and **look at it** (the Read tool shows .jpg/.png). It clearly shows the
     subject, is recognisable on a phone, and has **no legible text that names the answer**.
   - The `alt` text describes the picture without naming or giving away the answer.
   - The question is at most 60 characters; options at most 25.

## What to write

Write `verified.json` in your folder: the batch as a JSON array, every question with two more fields:

- `"verdict"`: `"OK"` (correct as it stands), `"FIX"` (you corrected it: the fields hold your corrected version), or
  `"DROP"` (it can't be made right, or it duplicates / gives away a bank question).
- `"check"`: one or two sentences of evidence: what you verified, against which source, and what you changed or why
  you dropped it.

Keep every field the writer had (including `commons`, `alt`, `sources`, `answerSource`); change only what's wrong.
Then reply with a short report: counts of OK / FIX / DROP, and every FIX and DROP in one line each.
