# Design

АЛМАНАХ looks like **a bright almanac** (DECISIONS.md, „How it looks and speaks“): a game, bright and alive. Every day
is an issue („Брой 31“), a stack of ten coloured sheets, one per chapter; what a player has got right in the issue is
written in ink in their Алманах. This file holds the rules. The values live in `web/src/app.css` (the tokens at its
top; a duel's result in `outcome.css`, the admin pages in `admin.css`), the pieces several screens share in
`web/src/ui.ts`, and the seal in `web/src/seal.ts`. Follow all of them when you add or change a screen. A change to
this file passes the rule for later (DECISIONS.md).

## Principles

- **Colour belongs to the chapters,** always with their glyph: a chapter's sheet, its tile, its seal. Everything
  else is ink on a light page by day and a light ink on a deep violet-blue page by night. There is no gold button, no
  green or red.
- **Right and wrong lead with shape and fill:** right is ink, filled, with a solid ✓; wrong is hollow and dashed, a ✕
  in a dashed ring; близо is half filled. Colour is never their only sign. **Dashes mean wrong**, and only that.
- **The almanac's forms, never a paper texture:** the issue's coloured sheet and its turned corner, ink and grey in
  the book. The folded corner belongs to the issue's cover and the Алманах's chapter cards, nothing else.
- **One obvious action per screen:** `.btn.primary`, a full-width bar of ink, raised a little („Започни“, „Напред“,
  „Сподели“). Everything else is an outlined `.btn` or a `.link`.
- **Numerals are the heroes:** the date, the score, the question's number, a chapter's ink, the streak, in Sofia Sans
  Extra Condensed, heavy.
- **Only what the game counts:** the score is the number right out of ten; ink per chapter, its seal; the streak.
  Nothing else adds up. A wrong game is never celebrated; a best rank rising and ten of ten are the big moments.
- **The seal is the only ornament.** It is never the logo (the rosette's four petals).
- **Few taps; leaving asks.** Every game starts one tap from where it's offered, and only a tap starts one
  (`startScreen()`). While leaving costs something (a question's time running), every way out asks first
  (`guardLeaving()`).
- **Phone first, a spread on a big screen.** Every screen fits a 320px phone with no sideways scroll, at the usual
  text size and at twice it. From 56.25rem a place is two pages side by side (`.spread`, `.page-1`, `.page-2`).

## Places and their budgets

Three places: **Днес** (`/`), **Алманах** (`/almanac`), **Приятели** (`/friends`). Профил and Настройки open from the
avatar in the bar (`/me`, `/settings`). Each screen holds its budget, in this order **in the HTML** (a big screen
places it in columns, never with `order`: `contrast.test.ts` forbids it; `e2e/fit.spec.ts` holds Днес's).

- **The frame** (`app.ts`): the bar holds the rosette and „АЛМАНАХ“ in spaced capitals (a way to Днес); on a big
  screen the three places as words on pills (`.places`); the avatar with the seal the player wears on its corner
  (`.bar-me`), or „Вход“ (straight to the sign-in form). On a phone the places are at the foot (`.places-foot`), the
  current one on a well, a dot on Приятели while a request or a friend's duel waits. The frame steps aside in a game
  (`html.playing`) and on a new visitor's cover (`html.cover`, no places).
- **Днес** (`screens/today.ts`): the issue; its action; the streak.
  - The issue (`.issue`): a stack of ten sheets (`.stack-leaf`) in the colours of its ten chapters, the top one the
    first question's, its corner turned on the second's (`leaf(…, { next })`). On it „Брой N“ on an ink pill, the
    weekday, the date set large with its month, „Десет въпроса за днес“, the ten glyphs (`.issue-toc`), and „Около
    три минути · Днес играха N души“ (the count from 100 players). Left half-way: „Следва въпрос 4 от 10.“ and its
    tiles so far, and „Продължи“; yesterday's left so just before midnight, while the game lets it be finished
    (`play.DayGrace`), comes first, with its date and „Вчерашният брой. Довърши го до 00:15.“ Come by a shared link:
    „Някой позна 7 от 10. А ти?“ and the shared tiles.
  - On a phone the cover is under half the screen (its date sized by the height), so that „Започни“ is whole by 500px
    on 320 × 568 and 540px on 375 × 600 (`fit.spec.ts`).
  - The streak (`.streak-chip`): the flame, the number and „изиграни дни“, from three days; under it a day the week
    forgave, or while the day waits what it makes of the streak (`stakeLine`).
  - On a big screen, under them, „В броя“: the ten chapters in their order.
  - A new visitor: the cover, „Започни“, and under it „Едни и същи за цяла България.“ In an app's own browser, one
    line under „Започни“: „Имаш игра в браузъра? Отвори там“ (`coverExit`).
  - Notices (a day forgiven, a friend's duel waiting) are one quiet line each over the issue, told once.
- **The day's result** (Днес once the day is played):
  1. The score on a sheet of the issue's first chapter: „Брой 9 · 20 ноември“, the score as the hero numeral „7 от
     10“, the tiles, „Десетият: вярно отговарят 14 %“ (or „Десетият е най-трудният днес“ before a crowd), and with a crowd
     „България днес: средно 6,2“. Ten of ten: „Всички верни“ and the mark drawn over it.
  2. On the first results (a guest's first day, a game just brought here, an app's own browser): the action, right
     under the score — keeping the game and being reminded, or the way out to the phone's browser; sharing then stays a
     quiet link beside the tiles („Сподели резултата“).
  3. The day's entry („Днес в Алманаха“, or „Най-рядкото ти попадение“ with a crowd): a sheet of its chapter with the
     chip, the answer as a headword, the question, the fact. Under it what the day wrote (`game/news.ts`): „+6 с
     мастило“; „Един от въпросите вече беше в твоя Алманах и остава в сиво.“; the chapter nearest its next rank with
     its seal and pips („История: още 2 до Книга“); ranks risen, their seals and one line; or a best rank risen, the
     big moment.
  4. Friends who played it, up to five (`.friends-day`): avatar, name, worn seal, their small squares, their score.
  5. The action, past the first results: „Сподели“.
  6. Tomorrow: the next issue's date set big, when it comes, what it makes of the streak; past the first results, the
     reminder's ask under it while reminders are off, a player with a profile's too (a plain button, never a second
     action; three times at most, once a day). Yesterday's issue finished after midnight has today's in its place
     („Вече излезе.“, „Към днешния брой“).

  Everything else is under „Въпросите и фактите“ (`.more`): how others played the player's recordings, how all of
  България spread, and each question with its fact (its verdict never a true-or-not's answer: „Точно“, „Не е това“).
- **Алманах:** its head (Микс and България as two ways to play, no lifetime totals), then the chapters, each a folded
  card in its colour with its seal as the badge (40px) and its ink („180 с мастило“); a counter at zero is hidden, and
  the head says once how ink is written. It leads with the chapter nearest its next step.
- **A chapter:** its head on its sheet (glyph, name, the seal with its pips, its ink, how much to the next rank),
  „Игра на главата“, then its facts, the latest first: ink black, facts met in grey (a thin solid 1.5px grey outline,
  lighter text). Where grey first shows: „В сиво са останалите срещнати факти. С мастило пише само броят на деня.“
  Its game's result: on the chapter's sheet its chip, the score and its tiles; under it, with no number (grey is never
  counted), „Фактите от играта са в книгата ти, в сиво.“ While the day's issue waits, „Към въпросите на деня“ is the
  action, the streak's stake under it, and „Още десет“ plain; once it's played, „Още десет“ the action.
- **Приятели:** the board (friends by default, or all of България: its spread and the player's place first, then the
  top rows); the friends (a row each: avatar, name, seal, today's score, the duels between you „дуели 3 : 1“); the
  duels („Твой ред“ the page's action, „Чакаш“, „Изиграни“: each its score and, on even right answers, what broke the
  tie; the record between two is the friend's row's alone). Two friends of one name show their @username. A duel's
  result is a spread on a big screen: the two face to face on the left, the record and the ways on on the right; its
  marks as the tiles (близо half filled), nothing ringed: speed only breaks a tie.
- **Профил:** the avatar with the seal worn on its corner, the name; the longest streak and what the week forgives;
  the seals by chapter, the one worn ringed in ink, another chosen behind „избери друг“; the avatars (every animal,
  and a chapter's art from its Страница, hollow with a grey ring and „История · от Страница“ until then); Настройки
  last; no list of past games (a game isn't gone over after its day). No
  duplicate avatar in the bar's corner on this page. Another player's page (`/players/<tag>`) is the same head,
  streak and seals, with the way to be friends.

## Colour

Day is on `:root`. Night replaces it under `prefers-color-scheme: dark` unless Day is chosen, and wherever Night is
chosen („Изглед“ in Настройки: `data-scheme` on `<html>`, `lib/prefs.ts`). So each Night rule is written twice:
`:root:not([data-scheme="day"])` under the media query, and `:root[data-scheme="night"]` outside it (`scheme.test.ts`
holds them equal). Never call this choice „Тема“: a „тема“ is what questions are about. A rule never holds a literal
colour but `#fff` and `#16132b` on a chapter's colour (which are the same in both themes); it takes a token.

| Token                      | Day                   | Night                 | Use                                                    |
| -------------------------- | --------------------- | --------------------- | ------------------------------------------------------ |
| `--bg`                     | `#f3f4fa`             | `#0e0c1d`             | the page                                               |
| `--surface`                | `#ffffff`             | `#1a1730`             | cards, answers, the bars, the answer's panel           |
| `--surface-2`              | `#eaecf5`             | `#262243`             | a well: the player's row, a letter's box, a tab chosen |
| `--surface-3`              | `#dfe1ee`             | `#312c54`             | a pressed key, a disabled action                       |
| `--ink`                    | `#16132b`             | `#f5f3ff`             | text, numerals, right (filled), the pips done          |
| `--ink-2`                  | `#47445f`             | `#cdc9e6`             | secondary text                                         |
| `--ink-3`                  | `#5d5a77`             | `#a7a3c6`             | kickers, meta, labels                                  |
| `--grey`                   | `#66637f`             | `#9a96bb`             | a fact met, in grey                                    |
| `--line`                   | `#dadced`             | `#34305a`             | hairlines, tracks                                      |
| `--line-2`                 | `#8a87a6`             | `#7f7aa8`             | control lines: an answer's 2px frame, a pip to come    |
| `--action` / `--on-action` | `#16132b` / `#ffffff` | `#f5f3ff` / `#16132b` | the one action                                         |
| `--on-sheet`               | `#16132b`             | `#16132b`             | text on a chapter's colour                             |
| `--danger`                 | `#b3261e`             | `#ff8f80`             | something gone wrong, a step that can't be undone      |
| `--gold`, `--petal`        | `#e0a81e`, `#16132b`  | `#e0a81e`, `#f5f3ff`  | the mark's petals                                      |

**The chapters** each have three colours, set as `--tv`, `--td` and `--ts` by `.t-<topic>`:

| Chapter    | Vivid `--t-` (both) | Deep `--d-` day / night | Sheet `--s-` night |
| ---------- | ------------------- | ----------------------- | ------------------ |
| general    | `#ffc21a`           | `#8a5d00` / `#ffc21a`   | `#cc9b15`          |
| science    | `#22ccc4`           | `#00777a` / `#22ccc4`   | `#1ba39d`          |
| history    | `#ff6b4a`           | `#c33a1c` / `#ff7f63`   | `#e05e41`          |
| geography  | `#4b90ff`           | `#1f5fd6` / `#6aa3ff`   | `#427fe0`          |
| movies     | `#e863e6`           | `#a52ba6` / `#ec7eea`   | `#cc57cb`          |
| music      | `#9a82ff`           | `#5a43e0` / `#a893ff`   | `#8873e0`          |
| sports     | `#ff9a2e`           | `#ad5300` / `#ff9a2e`   | `#cc7b25`          |
| technology | `#a3db2e`           | `#4c7700` / `#a3db2e`   | `#82af25`          |
| literature | `#ff77ae`           | `#c42d6c` / `#ff89b9`   | `#cc5f8b`          |
| nature     | `#33cf7a`           | `#0f8148` / `#33cf7a`   | `#29a662`          |
| Микс       | `#c9c4de`           | `#4a4766` / `#c9c4de`   | `#a19db2`          |
| България   | `#2ec4a0`           | `#0b7a60` / `#2ec4a0`   | `#259d80`          |

- **Vivid** is a tile, a seal, a glyph's ground, and a large sheet by day; **deep** is a line or a word in the
  chapter's colour on the page (a hollow tile's outline, the seal's fine edge by day); **sheet** is a large sheet by
  night: 20% darker for the light chapters, 12% for История, География, Кино and Музика, so that the dark ink on it
  holds 4.5:1.
- **Contrast** (`contrast.test.ts`, both themes): text 4.5:1 on `--bg`, `--surface` and `--surface-2`; `--line-2`
  3:1; the ink on every chapter's sheet 4.5:1. `e2e/a11y.spec.ts` checks text with axe.
- A chapter's art takes its vivid as `--tone`; art drawn on white (a glyph, a tile, the seal's core) keeps the day's
  inks by night too.

## Type

- **Faces:** Sofia Sans 400–900 (`--font-sans`) for everything, and Sofia Sans Extra Condensed 600–900
  (`--font-numeral`) for the numerals that matter, tabular. Our own files in `web/src/fonts`, each cut into a file for
  Bulgarian and one for the rest (`subset.sh`, `fonts.test.ts`); never a font from another host. With `lang="bg"`,
  Sofia Sans draws the Bulgarian letter forms (д, л, т): keep them.
- **Scale** (phone / big screen; display type grows at half the rate the text does, Large text):

  | Role                                 | Size                         | Weight                 |
  | ------------------------------------ | ---------------------------- | ---------------------- |
  | The date on the cover                | 64–152px by height / 240px   | numeral 900, line 0.82 |
  | The score                            | 128px (34vw at most) / 192px | numeral 900            |
  | A big figure (streak, ink, tomorrow) | 48–52px                      | numeral 900            |
  | The question's number in a run       | 32px                         | numeral 900            |
  | `h1`                                 | 32 / 44px                    | 900, −0.01em           |
  | The question                         | 26 / 38px (18px under 620px) | 900                    |
  | `h2`, a section's heading            | 22px, 20px                   | 900                    |
  | An answer                            | 18px                         | 800                    |
  | Body (a fact)                        | 17px, line 1.45              | 500                    |
  | Small and meta (`.small`)            | 14px                         | 600–700, `--ink-3`     |
  | A kicker (`.kicker`)                 | 12px                         | 800, capitals, 0.12em  |
  | The name in the bar                  | 15 / 17px                    | 900, capitals, 0.2em   |
- **Case:** sentence case everywhere; capitals only through `.kicker` and the wordmark.

## Shape and space

- **Radii:** 10px (`--r-1`, a letter's box), 16px (`--r-2`, an answer, a button, a row card), 24px (`--r-3`, a card, a
  sheet). Round for avatars, glyphs and seals.
- **Space** on a 4px base (`--space-1` … `--space-7`: 4 · 8 · 12 · 16 · 24 · 32 · 48); the page's gutter is 16px on a
  phone, 40px on a big screen; the page is up to 1260px.
- **Cards** (`.card`, `.rows`) are white surfaces on the page; rows have a hairline between them and are 48px or more.
- **Depth:** the primary action is raised by a 4px shadow below (`--lift`); the answer's panel docked at a phone's
  foot casts a soft shadow up. Nothing else.
- **Touch targets** are at least 44px; anything drawn smaller gets its room around it (`e2e/text.spec.ts`).
- **Focus:** one rule for everything (`:focus-visible`): a 3px ink outline, 2px off the edge.

## The pieces

- **The sheet** (`leaf()` in `ui.ts`, `.leaf`): a chapter's colour (`--ts`), the dark ink on it, round corners. With
  `{ next }` its corner is turned (`.folded`, `.fold`): the back of the sheet lighter, a fine shade on its edge, and
  under it the next sheet's colour (`.leaf-next`) — the issue's cover and the chapter cards only.
- **The glyph** (`glyph()`): a chapter's art on a white disc. **The chip** (`chip()`): the glyph and the chapter's name
  on a white pill. Wherever a chapter's colour is, its glyph is.
- **The tiles** (`tiles()`): the day's ten in their chapters' colours, a glyph on each. Right: filled, the glyph on a
  white disc. Близо: the left half in the chapter's colour, the right half hollow, the glyph straight over both, a
  2.5px outline in the deep colour. Wrong: hollow, a dashed outline, the glyph faded. A void one dashed and empty; one
  to come a quiet well. They read at 28px. **The small squares** (`mini()`, 10px): a friend's or a board's row, in ink.
- **The pips** (`.trail`): a run's ten, a bar each: done right filled in ink, близо half, wrong hollow, the one asked in
  its chapter's colour and ringed, the ones to come quiet with a `--line-2` edge.
- **The seal** (`seal()`, `seal.ts`): a chapter's rank drawn, its colour and its glyph, one silhouette per rank and
  never a gear's teeth:

  | Rank     | Ink from | Silhouette                                   |
  | -------- | -------- | -------------------------------------------- |
  | Бележка  | 1        | an open ring                                 |
  | Страница | 5        | a solid disc                                 |
  | Тетрадка | 15       | six shallow scallops                         |
  | Книга    | 40       | the six scallops, a 2px ink ring inside them |
  | Том      | 100      | ten shallow scallops and a ribbon's tail     |
  | Летопис  | 250      | the same with two tails                      |

  Then „Летопис · N“ for each further 100, its number on a tab from 32px. 24px at the least. How far towards the next
  rank is four pips under it (`pips()`), from 32px, on a chapter's page and the result's line only. By day a fine
  outline in the deep colour; on a sheet (its own colour, often) a 2px ink rim (`.rimmed`). Beside a player's name only
  the seal shows, never its rank's word (`worn()`); the word is the Алманах's and a rank-up's.
- **Buttons:** `.btn` (outlined in `--line-2`), `.btn.primary` (the one action), `.btn.danger`, `.link` (`.tap` for a
  finger's height). Fields (`input`) are white boxes with a 2px `--line-2` frame, a button's height. `.segmented`: tabs
  or a setting's few choices on a well, the chosen one a raised surface. A switch is a 52 × 30 track. Never a native
  select, radio or checkbox.
- **Sheets over the page** (`.sheet`, a `<dialog>`): a surface with round top corners over a scrim, from the foot on a
  phone, centred on a big screen (a name asked for, the share).
- **Rows of players:** `who()` (avatar and name, the worn seal after it), `rankRow()`, `.fd-row`, `.friend`,
  `.duel-row`. **Avatars** (`avatar()`): the drawn animal in a round medallion of its scene; a chapter's art becomes an
  avatar at Страница.
- **What went wrong** is never a dead end: `failure()` says what happened, offers „Опитай пак“ where it can help, and
  always a way on.

## Play

A run (`game/run.ts`) on a phone is a column the screen's height: the head, the pips and the clock at the top (kept in
sight as the page scrolls, smaller once stuck), the question's sheet under them, what answers it at the foot under the
thumb. On a laptop (64rem) it's a spread: the head and the sheet on the left; what answers it on the right, the answer
under it.

- **The head** (`.question-head`): the cross out („Към Днес“), what's played („Брой 31“, the chapter, „Дуел с Мария“
  over it), and the number big: „4/10“ to the eye, „4 от 10“ aloud. Nothing counts right answers in a row.
- **The clock** (`.timer`): a bar under the pips, the seconds at its end; ink and heavier for the last ten seconds;
  gone once answered. Its sound: silent until ten seconds are left.
- **The sheet** (`.q-leaf`, no corner): the chip (and on the day's last question „Трудното число“ beside it), then the
  question. Under 620px of height the chip is the glyph alone. A picture over the question takes at most 30% of the
  height; a choice of pictures is two by two.
- **Answers** (`.option`): white, a 2px `--line-2` frame, the letter in a box (А–Г, keys 1–4 on a computer).
- **Answered:** the player's own right answer is ink — a dark fill with white text by day, a light fill with dark
  text by night — and a solid ✓; the right one they didn't give has a 3px ink outline and a ✓ in a ring; their wrong
  one is hollow and dashed with a ✕ in a dashed ring and „ти“. The rest shrink to a 36px line of their own words, so
  that the player's row and the right row are right under the question. The crowd's shares fill in behind each
  answer.
- **Each kind:** true-or-not, two side by side; order, rows of 48px picked up and put down or dragged by their grip,
  answered as the right order — a row in place with a solid ✓, one out of place hollow and dashed with „ти: 3-ти“;
  match, two columns, the left lettered А–Г and a right one joined taking its left one's letter (never colour);
  split, a card sent left or right; clues, coming out as their time does; number, typed on the game's own pad (keys
  44px at the least), answered as what was said, the answer, and both on a scale (the answer a filled square; „ти, вярно“ a filled disc,
  „ти, близо“ half filled, „ти“ hollow).
- **The answer** (`.after`): docked at a phone's foot, a surface over the answers, at most what leaves the player's
  row and the right one in sight; a longer fact scrolls in it, fading out above „Напред“. In it, the verdict, how many
  got it, „Записано с мастило · глава История“ for ink, „Знаеше ли?“ and the fact, and „Напред“ (the one action).
- **Verdicts** are a fixed set, never an answer's own word: „Точно!“, „Вярно!“ (a number near enough to count, not
  spot on), „Не е това.“, „Близо, но не се брои.“, „Времето изтече.“ The verdict's sign is ink: a filled disc with ✓, a half-filled disc, a ✕ or a clock in a dashed
  ring.
- **Leaving** while a question's time runs asks in a sheet at the foot („Остани“, „Излез“).

## Fit and large text

- **Fit** (`e2e/fit.spec.ts`, at 320 × 568, 375 × 600, 390 × 664 and 1366 × 900, by day and by night): nothing
  scrolls sideways; Днес shows „Започни“ whole and high; a question shows every answer or its pad and action; once
  answered, the player's row, the right one and „Напред“ are in sight.
- **Large text:** the text grows with the browser's setting and with „Размер на текста“ (up to twice). Everything is
  in rem from `<html>`; display type grows at half the rate (half px, half rem) and a big numeral is capped by the
  screen's width or height. One-column grids are `minmax(0, 1fr)`; a row of things wraps. `lib/prefs.ts` puts `tight`
  and `tighter` on `<html>` when the column holds few words, and rows give way to columns there. A media query's rem
  is the browser's own size, so a short screen is a phone on its side only with `(orientation: landscape)` too.
  `e2e/text.spec.ts` holds it.

## Motion

- **At most 400ms an animation;** one big moment a result: a best rank risen (the seal set large, `rankup`), or ten of
  ten (the mark drawn petal by petal). A right answer pops (360ms, to 1.04), a wrong one shakes once (320ms, 4px); an
  answer comes into place in one movement (240ms, `settle`); a pip lands (200ms).
- **A result lands, once** (`feel.ts`): the tiles fill one by one with a pluck on the scale for each right one, and
  the score lands; a tap jumps to the end; never again on a reload.
- **No ambient motion,** no confetti. **Less motion** („По-малко движение“, following `prefers-reduced-motion` until
  set): the pops, shakes and steps stop; the clock and the count before a run still move, as they are information.

## Sound

Made in the browser, in code (`feel.ts`, `lib/sound.ts`): one key (D major pentatonic), the motif D–A–F♯–D as bells
for the end of a game, a wooden pluck for the player's touches, a soft thud for a wrong answer (never a buzzer), a
short beep for the clock's last seconds. One sound per moment, only game moments; on by default, one switch in
Настройки.

## Pictures

Drawn by hand as paths (`art/pictures.ts`), placed with `picture(id)`, loaded as a file of their own: fifteen animals
(everyone's avatars), a picture per chapter (its glyph), the book, the duels, Рила for България, the flame. One style:
flat shapes with depth, lit from the top left, no outlines, painted from one tone in its inks (`k0`–`k5`, `kw`, `ks`,
`kh`, `kt`). Art never changes the rules. A new picture is checked at its smallest (24px) in both themes.

## The share

- **The text:** „Брой 42 · 8/10 · 23 дни“ (the streak from three days), the squares ■ right, ◧ близо, □ not, and the
  link (`game/share.ts`). Unsigned.
- **The card** (`game/card.ts`), drawn in the browser as it's shared, one look in every theme: the mark and the name,
  „Брой N“ big with its date, the ten tiles two rows of five (filled, half, dashed and hollow: they part in grey too),
  and almanac.bg. No score, no streak, no name. The server's card (`internal/card`) stays for a link's preview.
- **The sheet** („Сподели резултата“): the card, the text, „Сподели“ (the text with its link, through the device's
  share sheet), „Копирай текста“, and „Сподели картинката“ where the device shares a picture. Never the text and the
  card together: an app given both may keep only the picture (WhatsApp on an iPhone), and the link is the share's
  point.

## Copy

- **Standard Bulgarian,** to one player with „ти“, short plain sentences, gender-neutral („ако броят още те чака“).
  Bulgarian words, not Russian ones, and not loanwords where a Bulgarian word is in common use (`language.test.ts`).
- **Buttons are verbs:** „Започни“, „Продължи“, „Напред“, „Сподели“, „Игра на главата“.
- **The nouns are a closed list** (DECISIONS.md): Брой, близо, серия, Алманах (глави, факти, мастило), печат, игра на
  главата (Микс, България), приятели, класация, дуел (запис), споделяне, профил, напомняне. A rank's six names are the
  seal's states; „звание“ is not a word the game uses.
- **Copy promises nothing the game doesn't do:** ink is „вярно отговорени“ in the issue, never „знаеш“; a counter at
  zero is hidden; an ended streak's number is never named.
- **Numbers the Bulgarian way** (`formatNumber()`): a space between thousands from 10 000; a decimal comma; „38 %“
  with a no-break space; the minus „−“; a unit after a no-break space; months in lower case. A number and the word it
  goes with („7 от 10“, „3 дни“) never part at a line's end.
- **No emoji in the interface.**

## In code

- `ui.ts`: `leaf`, `glyph`, `chip`, `tiles`, `mini`, `seal`, `pips`, `worn`, `avatar`, `who`, `rankRow`, `verdict`,
  `fact`, `filed`, `segmented`, `failure`, `rosette`, `back`.
- `game/run.ts`: `trail`, `questionHead`, `timer`, `settle`; `game/questions.ts` each kind; `game/news.ts` what a game
  wrote; `game/share.ts` and `game/card.ts` the share.
- **Selectors:** a part has its own class (`.status-n`), not a tag under a class; Biome flags the other kind. A class
  nothing names any more goes, with its rules.
- **Test hooks** the browser tests depend on: `.question-head`, `.options .option`, `.keypad`, `.sortable-list`,
  `.verdict`, `.after`, `.up-next-go`; `.issue`, `.issue-go`, `.today-side`, `.result`, `.result-main`, `.score-n`,
  `.tiles .tile`, `.tomorrow`, `.result-share`, `.share-sheet`, `.streak-chip`, `.day-entry`, `.friends-day`;
  `.summary`, `.reviewed`, `.news-facts`; `.toc-row`, `.entry`; `.day-board`, `.rank-row`, `.friend`, `.invitation`,
  `.duels`, `.duel-row`, `.their-line`.

## Before a UI change ships

- **Look at it** on a seeded database (CLAUDE.md) as its personas, by day and by night, at 320, 375 × 600 and 390 ×
  664 and at 1366px, and at twice the text.
- **Run the checks:** `npm run check && npm test` (with `contrast.test.ts`), then the browser specs the change touches
  in Chromium, `e2e/fit.spec.ts` and `e2e/a11y.spec.ts` among them.
- **Keep it light:** `go run ./cmd/build` holds the first screen to its budget.
