# Design

АЛМАНАХ looks like a modern magazine that keeps score: Night first, gold for the one right answer, numbers as the
heroes, and game feel drawn only from what the game really counts. This file holds the rules. The values live in
`web/src/app.css` (the tokens at its top), and the pieces several screens share live in `web/src/ui.ts`. Follow all
three when you add or change a screen.

## Principles

- **One obvious action per screen**, and it is the gold button: `.btn.primary`, plus `big` for a screen's main
  action. Everything else is a plain `.btn` or a `.link`.
- **Gold means the one right answer**, as in the logo: the primary action, progress (the timer, the current pip,
  the streak) and reward (points, first place). Nothing is gold for decoration.
- **Numbers are the heroes.** Scores, places, the streak, the timer and room codes use the numeral face, with
  tabular figures.
- **Game feel comes only from data the game has** (see Game feel below). No currencies, shops or made-up numbers:
  the level is the XP a player has really earned by playing, and every achievement is a fact of their games.
- **Phone first.** The layout is one column, at most 40rem wide, with a 16px gutter. Every screen fits a 320px phone
  without scrolling sideways.

## Colour

Night is on `:root`; Day replaces it under `prefers-color-scheme: light`. A rule never holds a literal colour: it
takes a token.

- **Grounds, back to front:** `--bg` (the page), `--surface` (cards that hold information), `--raised` (things you
  press: buttons, answers) and `--sunken` (tracks, wells, inputs). Set them apart with depth (`--elev-1`,
  `--elev-2`) and `--line`, not with borders.
- **Text:** `--text` and `--text-muted`. Links, focus and the player's own choice use `--accent` (`--link`).
- **Fills:** `--gold`, `--lilac`, `--right`, `--wrong`, `--sky`, `--rose`, `--silver` and `--bronze`, always with
  `--on-fill` text on them. A meaning set as text uses its `-ink` twin: `--gold-ink`, `--right-ink`, `--wrong-ink`,
  `--sky-ink` or `--rose-ink`.
- **What each colour means:**
  - `right`: a right answer.
  - `wrong`: a wrong answer, the last five seconds, deleting.
  - `rose`: duels and friends (an invitation to a duel, the record between two friends).
  - `sky`: rooms.
  - `lilac`: levels.
  - `silver` and `bronze`: second and third place.
- **Topics** keep one colour everywhere: `toneOf(category)` in `ui.ts` gives gold, lilac, sky, rose or mint, in
  the bank's order.
- **Right, close and wrong never rest on hue alone.** Each also gets ✓, ∼ or ✕, the word, and a filled or hollow
  mark.
- **Contrast:** text holds at least 4.5:1 on its ground in both themes. `e2e/a11y.spec.ts` checks this with axe.

## Type

- **Faces:**
  - Sofia Sans for words (`--font-sans`).
  - Sofia Sans Extra Condensed for numbers (`--font-numeral`).
  - Literata italic for the „Знаеше ли?“ facts and nothing else (`--font-serif`).
- **Our own files:** the faces are served from `web/src/fonts` (SIL OFL 1.1). Never load a font from another host;
  the CSP allows `font-src 'self'` only.
- **Bulgarian forms:** the page is `lang="bg"`, so Cyrillic takes its Bulgarian forms (д, т, л). That is intended.
- **Scale:**
  - `h1` 34px (40px on wide screens), 800 weight, -0.03em tracking.
  - `h2` 26px.
  - The question (`.ask`) 24/30, 700 weight.
  - Body 16/24; `.lead` 18/26 in muted.
  - `.kicker` 12px, 800 weight, capitals with 0.14em tracking, for the date, the topic and section titles.
- **Numerals:** 120px for the result, 56px for the question count, 52px for stats and the streak, 32px for figures
  and points.
- **Case:** sentence case everywhere. Capitals come only through `.kicker` and `.tag`.

## Shape and depth

- **Radii:** `--radius-md` for buttons, answers and inputs; `--radius-lg` for cards; `--radius-xl` for the one hero
  card; `--radius-full` for tracks, pills and place discs; `--radius-xs` for trail pips.
- **Depth:** `--elev-1` at rest, `--elev-2` on hover or for the hero card.
- **Glows are rewards:** `--glow-gold` on the primary button, first place and an exact answer; `--glow-right` on a
  right answer. Nothing else glows.
- **Focus:** `--focus`, a ring in the ground colour then in `--accent`, drawn as a box-shadow so it follows the
  corners.

## The pieces

- **Layout:** `.screen`, `.stack`, `.intro`, `.title-row`, `.card` and `.card.hero`.
- **Text:** `.kicker`, `.lead`, `.muted`, `.bad` (errors) and `.status`.
- **Controls:**
  - `.btn`, with `primary`, `big`, `rose` (accepting a friend request), `danger` and `inline`; and `.link`.
  - `.field` and `input.code`; `.join` for an input with its button.
  - `.tag` and `.chip`.
- **Numbers:** `.figures`/`.figure`, `.stats`/`.stat`, `.streak` (with `.week`), `.games`/`.game`.
- **Mastery:** `.mastery` (the tier's bars, lit in the topic's tone, and its name), `.mastery-list`/`.mastery-row`, and
  `.mastery-card` (with `up` for a new tier) on a result.
- **Play:**
  - `.question-head` (with `.count`), `.trail`, `.timer` and `.ask`.
  - `.options .option`, with the states `picked`, `placed`, `right`, `wrong` and `dim`.
  - `.verdict` and `.fact`.
- **Progress:**
  - `.avatar` (a shape `av-…` on a tone `tone-…`, sizes `s` and `l`, the level in `.lv`), drawn by `avatar()`.
  - `.who` (avatar, name, `.who-title`) for a player on a board or a list, drawn by `who()`.
  - `.level-card` (with `up` for a new level), `.unlock` (a new achievement), `.badge-mark`.
  - `.achievements`/`.achievement` (and `locked`), `.picker`/`.pick` and `.tone-pick` for choosing a look.
- **Results:** `.summary`, `.board`/`.row` (with `p1`–`p3`, `me`, `gap` and `moves`), `.topics`/`.topic`,
  `.players` and `.settings`.
- **Friends:** `.card.friends`, `.invitation` (a friend request, accepted with `.btn.rose`), `.friend-list`/`.friend`
  (with `.friend-day` and `.record`) and `.invite-link`.
- **In code:**
  - `ui.ts` has `verdict`, `fact`, `streak`, `stat`, `figure`, `meter` and `toneOf`.
  - `game/mastery.ts` has `masteryBadge`, `masteryCard` and `masteryMoves`.
  - `game/run.ts` has `trail`, `questionHead` and `timer`.
  - `game/results.ts` has `summary`, `board`, `boardRow` and `shareButton`.
- **Selectors:** give a part its own class (`.streak-num`) rather than a tag under a class (`.streak b`). Biome's
  `noDescendingSpecificity` flags the second kind.
- **Test hooks:** the browser tests depend on these classes; keep them:
  - `.question-head`, `.options .option`, `.number`, `.keypad` and `.sortable-list`
  - `.up-next`, `.summary`, `.reviewed` and `.verdict`
  - `.players li`, `.friend`, `.invitation` and `.invite-link`

## Tiers

- **Four tiers of achievement**, each with its colour: обикновено (silver, `--tier-common`), рядко (sky,
  `--tier-rare`), епично (violet, `--tier-epic`) and легендарно (gold, `--tier-legendary`). Each has an `-ink`
  token for words. A `.t-<tier>` class sets `--tier` and `--tier-ink` for anything inside it.
- **Medals are generated** (`web/src/art/badge.ts`), never drawn by hand: the tier gives the form — common round,
  rare a hexagon, epic an eight-pointed star, legendary a sunburst with laurels — and the achievement's shape sits in
  the middle. Earned: filled in the tier's colour with a rim and a light (epic and legendary glow). Locked: hollow,
  with a ring for its progress. Hidden and not found: a „?“, and nothing about how or what it gives.
- Every achievement says how it's earned, how far along the player is, and its reward (the avatar shape, the
  title). A title shows in its tier's ink wherever it's worn.
- **Division emblems are generated** (`web/src/art/emblem.ts`): a silhouette per division — Бронз a plain shield,
  Сребро a chevron, Злато wings, Платина a star, Диамант a cut gem, Легенда a crowned star shield with rays — in
  `--div-*` colours.
- **Avatar frames are generated** (`web/src/art/frame.ts`) around the rounded tile: Пръстен, Двоен пръстен, Точки,
  Пламъци, Лавров венец, Кристал, Ореол, and a season's podium (Шампионска, Сребърна, Бронзова: stars at the corners
  in the place's metal); **patterns** behind the shape are CSS (`.bd-dots`, `-stripes`, `-grid`,
  `-rays`, `-stars`). Both unlock by level, achievement or the highest division reached, and show on every avatar
  (the server sends a look's avatar as `shape-tone/frame/backdrop`).
- **Season art is generated** (`web/src/art/season.ts`): the podium's medals — gold, silver, bronze — in the
  divisions' metals.

## Flow

- **The game moves on by itself.** There is no „Напред“ anywhere: an answer shows for 3 seconds (4.5 where there's
  more to read: a number, an order), with a line filling under it, and the next question opens. A room shows each
  answer with its standings for 6 seconds; a live duel shows both answers for 4 seconds (6 for a number, an order or
  a match). A question never opens in a tab that's out of sight.
- **What isn't the game waits for the end.** „Знаеше ли?“ and „Нещо не е наред с въпроса?“ are in the review after
  the last answer (of a run, a duel or a room), not between questions.
- **Time:** 20 seconds a question, 10 for „Вярно или невярно“, 25 to put things in order, 30 to join four pairs
  („Свържи“). When the time runs out, whatever has been put in (a
  typed number, things moved into an order) is the answer.
- **Input without the phone's keyboard:** a number is typed on the game's own pad (a comma only where the answer may
  have decimals, a minus only for temperatures); things to order are dragged into place, or moved with the arrow
  keys.

## Game feel

Every element that looks like a game measures something the game already counts:

| Element      | Measures                                                                                                                                                                                                                                    | Where                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Streak       | Days in a row with the day's ten; the strip is this week's days played (`week` in `/api/day` and `/api/me/stats`)                                                                                                                           | Днес, Профил                 |
| Points       | One game's score, per answer and per run, from the server (with the parts for speed and for the row); a right answer about 1000; never added up across games                                                                                | Verdict, result, day board   |
| In a row     | Right answers in a row within a game, from the second (the flame and „3 поред“); each earns a tenth more, up to a half                                                                                                                      | Question head, verdict       |
| XP           | What playing earns: 10 an answer and 10 more times its score, 50 a finished game, 50 more for the day's, 100 a daily goal; adds up                                                                                                          | Level, level board, goals    |
| Place        | Place on the day's board („12-и от 318 днес.“)                                                                                                                                                                                              | Result, Профил               |
| Mastery      | Share of a topic's questions a player knows, from every answer weighed by its question's hardness (play/mastery.go); told after 10 answers, in six tiers: Новак, Любител (35%), Познавач (50%), Експерт (65%), Майстор (78%), Светило (90%) | Игра, Профил, result         |
| Rank change  | Places moved since the previous answer                                                                                                                                                                                                      | Room boards                  |
| Duels        | Live with whoever comes (a recording of a real game if nobody does in 30 s), a friend in their own time: won of played; between two friends, their record („3 : 2“)                                                                         | Дуел, Профил                 |
| Rating       | Elo from 1000, moved by duels and Роял; shown as a division (Бронз → Легенда) with its generated emblem                                                                                                                                     | Дуел, Роял, Профил, Класации |
| Роял         | Live every evening at 21:00 (lobby from 20:45): up to 50 on the same question at once, 15 in three rounds; the first wrong answer is out, then watch                                                                                        | Роял, Класации               |
| Goals        | Three a day (the day's questions, and two drawn), each 100 XP once done, told at the game's end                                                                                                                                             | Начало, result               |
| Season       | The rating's calendar month: placed after 10 rated games; at its end the first three win a medal, a frame and a title that counts („Двукратен шампион“), and every rating goes halfway back to 1000                                         | Класации, Профил             |
| Boards       | Rating (the season's), level (all XP) and knowledge (share right after 100 answers, or 30 in a topic), of everyone or of friends                                                                                                            | Класации                     |
| Friends      | The day's board among you and your friends („Приятели днес“), once a friend has played                                                                                                                                                      | Result                       |
| Level        | All the XP a player has earned; each level takes 150 more than the last (300 for the first)                                                                                                                                                 | Result, Профил, avatars      |
| Achievements | 19 facts of a player's games in four tiers (обикновени, редки, епични, легендарни), each saying how it's earned; announced once                                                                                                             | Result, Профил               |
| Titles       | The names of a player's achievements, in their tier's colour; all listed, the locked ones with what unlocks them                                                                                                                            | Boards, friends, rooms       |
| Avatars      | A shape on a tone: nine shapes free, nine unlocked by achievements (the crown at level 10)                                                                                                                                                  | Everywhere a player is       |

Feedback fires once, when it's earned, and then the screen is still again:

- A right answer pops and glows.
- Points rise in gold, counting up to what was earned.
- An exact number answer gets the star.
- A wrong answer shakes once.

## Copy

- **Language:** standard Bulgarian (Bulgarian words, never Russian ones: see `CLAUDE.md`), to one player with „ти“,
  in short plain sentences. Text must be gender-neutral.
- **Buttons** are verbs: „Започни“, „Отговори“, „Още десет“.
- **Verdicts** are a fixed set: „Точно!“, „Вярно!“, „Близо.“, „Не е това.“ and „Времето изтече.“
- **Numbers the Bulgarian way:**
  - a space between thousands from 10 000 up („1380“, „12 500“);
  - a decimal comma;
  - a unit after a space („15 с“);
  - places as „12-и“.
- **No emoji in the interface.**

## Motion

- **Timings:**
  - presses 120ms; hover and colour 160–200ms;
  - the right answer's pop 360ms; the wrong answer's shake 320ms;
  - the points' rise 520ms;
  - the timer runs linearly with the clock.
- **No ambient motion** and no confetti.
- **Reduced motion:** under `prefers-reduced-motion` the pop, the shake, the rise and the transitions stop. The timer
  still moves, because it is information.

## Sound

- **Tones made in the browser** (`web/src/lib/sound.ts`): there are no files to load. Each sound is a few notes,
  quiet, and over in under half a second.
- **One sound per moment**, and only for game moments:
  - `tap` when an answer is given;
  - `key` for each key of the number pad and each move in an order;
  - `right`, `exact`, `partial`, `wrong` or `time` with the verdict;
  - the clock while a question waits: `tick` and `tock` in turn each second, then `hurry` in each of the last five;
  - `end` when a run's result opens;
  - `level` and `achievement` with the news;
  - `ping` when a game or a duel starts, or a friend calls to a duel.
- **Nothing plays** for navigation, hovering or decoration.
- **On by default**, with one switch in Профил („Звуци“) that's kept on the device. The audio starts on the
  player's first touch, as browsers require; a sound that isn't allowed yet is skipped, never queued.

## Icons and the logo

- **Icons:** no icon font and no emoji. Icons are CSS masks drawn in `currentColor`: `--i-check`, `--i-cross`,
  `--i-near`, `--i-clock`, `--i-star`, `--i-up`, `--i-down` and `--i-flame`. A new icon is a 24px drawing with 3px
  round strokes, added the same way.
- **The logo** is the rosette (`web/public/favicon.svg`): four petals on the ink tile, one gold. Use it as it is.
  The header shows it at 32px with a 1px `--line` ring, beside „АЛМАНАХ“ at 900 weight with 0.12em tracking.
- **Share images:** `web/public/og.png` and `.github/social-preview.png` are drawn in the same style.

## Before a UI change ships

- **Look at it** in both themes, at 320px and 390px wide. Nothing may scroll sideways, and keyboard focus must show.
- **Run the checks:** `npm run check`, then the browser tests (`npm run e2e`), which include the accessibility
  checks.
- **Keep to the budgets:** 14 kB of CSS and 40 kB of JS, gzipped. `go run ./cmd/build` fails over them.
