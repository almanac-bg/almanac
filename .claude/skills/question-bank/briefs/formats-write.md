# АЛМАНАХ — writing picture, number and ordering („Подреди“) questions

АЛМАНАХ (almanac.bg) is a Bulgarian quiz game. Players learn from it, so a wrong answer or a wrong fact is the worst bug
it can ship. You are drafting questions in one of its special formats. Your draft is checked by a separate agent afterwards, but
write it as if nobody would check.

## Ground rules

- Work only in the folder you're given. Never edit `private/questions.json` or anything in the repository; read them
  freely.
- Never send personal data anywhere: no names or email addresses in User-Agent headers, search queries or URLs. Use the
  User-Agent `AlmanacBank/1.0 (https://almanac.bg)` for every request to Wikimedia.
- Node isn't on PATH: `export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"`. Run commands from
  `/Users/hristo/Developer/quiz`.
- The bank already has over 3000 questions (`private/questions.json`, one per line). Grep it for your topic and answer
  before writing: no near-duplicates, and nothing that gives another question's answer away (a match mixes all
  categories). `node .claude/skills/question-bank/bank.mjs similar <your-draft.json>` lists look-alikes (it reads `q`
  and `options`; ordering drafts: run it on a copy where `options` = the four item texts).
- Bulgarian, for Bulgarian players. Text addressing the player is gender-neutral. Typography as in the bank: „…“
  quotes, a spaced em dash —, ’ and … characters, „г.“ after a year in running text; Нидерландия (not Холандия).
- Difficulty for Bulgarian adults: easy = most adults know it, medium = a well-read person, hard = an enthusiast (still
  with plausible distractors and a gettable answer; never the exact date of a minor event).
- Nothing that goes stale („сегашният“, „най-новият“, records that may fall) unless pinned to a date („през 2023 г.“).
- `fact` (optional but wanted on most): one or two sentences, 20–200 characters, ending with a period; something true
  and surprising about the answer that the question didn't say; claim only what the source says; `factSource` is an
  https page supporting every claim in it. Bulgarian number style: four digits without a space (6000), a non-breaking
  space (U+00A0) between a number and its unit or „г.“ (2925 м, 1885 г.). It must not name another bank question's
  answer.
- Every question carries `answerSource`: an https page that confirms the answer (Wikipedia bg/en is fine; better an
  official or museum page).
- Give each question `"added"` with the date your task gives (`YYYY-MM-DD`) and, when it is about Bulgaria, `"tags": ["bg"]`.

Write the draft as a JSON array to the file you're told, then report back briefly: how many, any you dropped and why,
and anything you were unsure of.

## Image questions

A picture over the question, four options under it (a 2×2 grid on a phone). The picture comes from **Wikimedia
Commons**; the game converts and hosts it itself.

Draft format (one object per question):

```json
{
  "category": "geography",
  "difficulty": "easy",
  "q": "Чие е това знаме?",
  "options": ["Казахстан", "Узбекистан", "Киргизстан", "Туркменистан"],
  "answer": 0,
  "commons": "File:Flag of Kazakhstan.svg",
  "alt": "Знаме: светлосиньо поле, в средата златно слънце над летящ орел, вляво златна орнаментна ивица",
  "fact": "…", "factSource": "https://…",
  "answerSource": "https://…",
  "added": "2026-10-29"
}
```

- `q` at most 60 characters, ending in „?“. The picture carries the question („Коя е тази планина?“, „Кой е авторът
  на тази картина?“, „Кое е това животно?“, „Кой е този учен?“).
- Options at most 25 characters each, four distinct, one defensibly right, the others plausible and of the same kind
  (all countries, all painters). Vary `answer` across 0–3.
- `commons`: the exact Commons file title. Check it with the API:
  `https://commons.wikimedia.org/w/api.php?action=query&titles=<title>&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=800&format=json`
  - Licence (`extmetadata.LicenseShortName`): only public domain („Public domain“, „PD-…“), CC0, CC BY or CC BY-SA (any
    version). Nothing else: no fair use, no GFDL-only, no „non-commercial“.
  - The original is at least 800 px wide (flags and other SVGs are fine at any size).
  - Artworks only if the artist died before 1956 (70 years). Ярослав Вешин, Иван Мърквичка, Антон Митов, Никола Петров
    are fine; Владимир Димитров – Майстора (died 1960) is not.
  - No film stills, posters, album or book covers, logos, banknotes or coins, no screenshots of games or software.
  - Portraits only of public figures (historical people, writers, scientists, athletes, actors); a free-licensed photo.
  - Download the 800 px thumbnail (`thumburl`) into your folder and **look at it** (the Read tool shows images; save as
    .jpg or .png). It must clearly show the subject, be good enough to recognise on a phone, and contain **no visible
    text that names the answer** (a caption, a sign on a building, a name on a jersey, a signature that's legible). A
    tight crop of the subject reads best on a phone.
- `alt` describes the picture for a blind player **without naming the answer or giving it away** (no name, no country
  of a flag, no title of a painting): what's in it, colours, shapes. 3–150 characters.
- Spread the subjects: Bulgarian ones in every category where they fit (at least a third of your questions should be
  about Bulgaria), and the rest from the world.

Category ideas (ids in brackets):
- [geography] flags, landmarks (Bulgarian and world), mountains, natural sites.
- [history] portraits of historical figures (photos or paintings in the public domain), historical paintings, fortresses
  and monuments.
- [literature] („Изкуство и литература“) paintings (who painted it / what is it called), writers' and painters'
  portraits, sculptures and buildings by famous architects.
- [music] folk and orchestral instruments (гайда, кавал, гъдулка, тамбура…), composers' portraits.
- [science] scientists' portraits, NASA images of planets and space (NASA images are public domain), lab instruments.
- [technology] („Технологии и игри“) historic devices and machines (ENIAC, a typewriter, a gramophone, an early phone),
  consoles and computers (a free-licensed photo of the device, no logos in focus), inventors.
- [sports] stadiums and arenas (no name on the facade in view), athletes' portraits, sports equipment.
- [movies] („Кино и телевизия“) portraits of actors and directors from Commons (free-licensed photos only — no stills
  or posters).
- [nature] animals and plants, Bulgarian ones too (родопски силивряк, еделвайс, рис, лалугер…).
- [general] („Обща култура“) traditions and customs (кукери, мартеници, сурвачки, нестинари), traditional dress, food,
  everyday objects, world symbols.

## Number questions (a match's final)

The last question of a match: the player types or slides a number; the closer, the more points, with a bonus for the
exact one. One per match, so each is seen rarely and remembered: it should be a number worth learning.

Draft format:

```json
{
  "kind": "number",
  "category": "geography",
  "difficulty": "medium",
  "q": "Колко метра е високо Мусала?",
  "number": { "answer": 2925, "unit": "м", "min": 500, "max": 9000, "step": 1, "scale": "linear", "tolerance": 300 },
  "fact": "…", "factSource": "https://…",
  "answerSource": "https://…",
  "tags": ["bg"],
  "added": "2026-10-31"
}
```

- `q` 10–150 characters, ending in „?“, asking for one number with one reading: say what is counted and as of when
  („според преброяването от 2021 г.“, „през 2024 г.“), and the unit when it isn't obvious („в метри“). Never „около“ in a
  question whose answer is exact; when the source rounds, ask for the rounded number („закръглено до милион“). The
  number itself never appears in the question.
- `answer`: the exact number from the source you fetched; a whole number of `step`s (step 1 for years and counts, 0.1
  for one decimal). Nothing where reliable sources disagree on the number (choose another question).
- `unit` (at most 12 characters): what the number counts, shown with the answer („м“, „км“, „години“, „души“, „%“);
  empty for a year.
- `min`/`max`: the range the keypad and slider allow. It must give nothing away: wide (at least 3 × `tolerance`), and
  the answer not in its middle (put it anywhere in the range). Years: a range of a few centuries around the answer.
- `tolerance`: how far off still scores. A well-read guess should land inside it, a wild one shouldn't: about a tenth
  to a quarter of a sensible range of guesses (Мусала 2925 м: 300; a year in the 20th century: 10–15; a count of 12:
  4). At least 2 × `step`.
- `scale`: `linear` almost always; `log` only for numbers whose guesses span orders of magnitude (populations of the
  world's cities, distances in space): then `min` > 0 and `tolerance` is a factor (1.5 = within ×1.5).
- What makes a good final: a number a Bulgarian adult can reason towards (a year they can place, a height they can
  compare, a count they can estimate), with a reveal that teaches something. Not a trivia ID number, not a phone code,
  not a number only an enthusiast could guess within the tolerance (even on hard).
- Counts, records and populations change: pin them to a year in the question, and give them `"reviewBy"` (a date,
  `YYYY-MM-DD`, about a year ahead) when the number may change.
- Grep `private/questions.json` for the number and the subject: no other question or fact may name this number on the
  same subject (it would give the final away), and this one's fact must not name another question's answer.

## Ordering questions („Подреди“)

Four things put in order by a number each has: a year, a height, an area, a length, a speed. The player taps them in
order; 250 points for each in its right place.

Draft format:

```json
{
  "kind": "order",
  "category": "history",
  "difficulty": "medium",
  "q": "Подреди от най-ранното към най-късното:",
  "items": [
    { "text": "Съединението", "value": 1885 },
    { "text": "Освобождението", "value": 1878 },
    { "text": "Независимостта", "value": 1908 },
    { "text": "Априлското въстание", "value": 1876 }
  ],
  "direction": "asc",
  "unit": "",
  "sources": ["https://…", "https://…"],
  "fact": "…", "factSource": "https://…",
  "answerSource": "https://…",
  "added": "2026-10-29"
}
```

- `q` 10–110 characters and it states the direction plainly: „Подреди от най-ранното към най-късното“, „Подреди от
  най-високия към най-ниския“, „Подреди по площ, от най-голямата“. A short frame first is welcome: „Кога са
  открити? Подреди от най-ранното.“
- `items`: four of the same kind (all events, all mountains), texts at most 30 characters, in any order in the draft
  (the game shuffles them). `value` is the exact number each is ordered by. Values at least 3 units apart (years at
  least 3 years apart; better spread so a well-read player can reason it out). Nothing where sources disagree about the
  order.
- `direction`: `asc` (smallest/earliest first) or `desc` (largest first), matching the question.
- `unit`: what the values count, shown at the reveal („м“, „км²“, „км/ч“); empty for years.
- `sources`: one https page per value (or one that covers several). `answerSource`: the main one.
- Populations only with a year in the question („през 2023 г.“); no superlatives that may change.
- Easy ones are reasoned out by most adults (big, well-known gaps); hard ones need an enthusiast.
- Good material: Bulgarian history in order, events of the 20th century, inventions and discoveries, films and albums by
  year, writers' works, sports championships, mountain heights, river lengths, country areas, planets' distances, animal
  speeds or weights (exact, sourced).
