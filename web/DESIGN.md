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
- **Few taps.** Every game starts one tap from Начало (the count before a topic's run starts by itself). A screen
  shows what it's for first and its details after, and folds away what's rarely needed (locked titles, hidden
  achievements) instead of listing it.
- **Phone first.** The layout is one column, at most 40rem wide, with a 16px gutter. Every screen fits a 320px phone
  without scrolling sideways.

## Places

Four main places, in a bar at the bottom of a phone (in the header on a big screen). Nothing else goes in the bar.

- **Начало** (`/`): the day first. The streak and the level side by side (each a way to Профил); the day's ten, or
  once played, how they went (the place a way to the day's board) with „Сподели“, the gold button, right under it
  and „Прегледай въпросите“ below; the day's goals; the ways to play with others, three in a row (the picture over
  the name on a phone); the topics, two by two (three on a big screen), and all of them at once. Дуел, Роял and Стая open from here and
  have a way back to it (`back()`). A player who hasn't finished a game yet sees only the day and the topics: the
  streak, the goals and the ways to play with others come after the first game.
- **Приятели** (`/friends`): requests, friends, and the ways to add them.
- **Класации** (`/ranks`): Днес (the day's board, first), Лига (the player's group this week; `/ranks#league`),
  Рейтинг and Знания; of everyone or of friends (not the league: a group is its own).
- **Профил** (`/me`): its own four places in a switch at the top (`profileNav()`): Общо (the player: level,
  league (once in one), streak, numbers, mastery, latest games), Награди (`/rewards`, the achievements), Гардероб (`/wardrobe`: what's
  worn as others see it, then Аватар, Рамка, Фон or Титла, one at a time) and Алманах (`/almanac`). Настройки open
  from the icon beside the name.
  Общо is a hub, each thing once: the level with what comes next in one card, the league in a line (its group is
  Класации'), the streak, three numbers in one card, mastery, the latest games. Награди opens with the three
  achievements nearest to done, in full; then each tier is a grid of medals (`.medals`/`.medal`), the earned first,
  and a tap opens a medal's card (`.medal-card`) across the row under it, one at a time.

## Space and size

- **Spacing** comes from the scale (`--space-1` … `--space-7`: 4, 8, 12, 16, 24, 32, 48): 24 between a screen's
  sections, 16 inside a card and between a section's title and what it heads, 8 between tiles of one grid.
- **Cards** have 16 of padding (`.card`), the hero 20.
- **Tiles** (a way to play, a topic) are a picture at 44–48px beside the name, at least 68px high, two to a row.
- **Touch targets** are at least 44px high; the bar's are its full height.

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
  the bank's order. Each also has its picture (see Pictures).
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

- **Layout:** `.screen`, `.stack`, `.intro`, `.title-row`, `.card` (with `.card-head` and `.card-title`) and
  `.card.hero`.
- **Getting around:** `.tabs` (the four places), `.back` (drawn by `back()`), `.subnav` (Профил's places, drawn by
  `profileNav()`), `.icon-btn` (a square with an icon and its name for screen readers) and `.more` (a `details` that
  folds what's rarely needed).
- **Начало:** `.status` with `.streak-chip` and `.level-chip`; `.card.hero.day`; `.modes .mode` and `.topics .topic`
  (`.topic-all` across the row).
- **Text:** `.kicker`, `.lead`, `.muted`, `.small`, `.bad` (errors) and `.status`.
- **Controls:**
  - `.btn`, with `primary`, `big`, `rose` (accepting a friend request), `danger` and `inline`; and `.link`.
  - `.field` and `input.code`; `.join` for an input with its button.
  - `.tag` and `.chip`; `.chips.scroll` for a row of chips that scrolls sideways (the page itself never does).
- **Numbers:** `.figures`/`.figure`, `.stats`/`.stat`, `.streak` (with `.week`), `.games`/`.game`.
- **Mastery:** `.mastery` (the tier's bars, lit in the topic's tone, and its name), `.mastery-list`/`.mastery-row`, and
  `.mastery-line` (how a topic's game moved it) in a result's „Ново за теб“.
- **Play:**
  - `.question-head` (with `.count`), `.trail`, `.timer` and `.ask`.
  - `.picture` over a question: while it's asked, `picture(view, true)` keeps it low enough for the question, the
    picture and the whole answering part to fit on the screen (no less than 128px); a question's time starts once
    its pictures are in.
  - `.options .option`, with the states `picked`, `placed`, `right`, `wrong` and `dim`.
  - „Раздели“: `.split` with `.split-deck` (the thing now on a `.split-card`, the next one `under` it; dragged, it
    names the group it's going to), `.split-sides` (the two groups as `.option.split-side`), `.split-pips` and
    `.split-back`; afterwards `.split-result`.
  - A choice of pictures: `.options.pic-options` (two by two), each `.option.pic-option` a picture with its letter
    (`.pic-letter`) and, once answered, its name (`.pic-name`); the pictures' credits in `.pic-credits`.
  - „Подсказки“: `.clues`, a `.clue` per clue with what a right answer is worth then (`.clue-worth`); the last one
    out is `now` (a gold edge: progress), the ones before it `past`, the ones to come `locked` (counting down).
  - How everyone else answered, once a question has enough answers: `.option.crowd` (a bar behind an answer as long
    as the share of players who gave it, the share beside it), `.spread` (where a number's guesses fell, the answer's
    part in `--right`, the player's in `--accent`) and `.crowd-says` (one sentence under the question).
  - `.verdict` and `.fact`.
- **Progress:**
  - `.avatar` (a picture on a tile of its tone `tone-…`, sizes `s` and `l`, the level in `.lv`), drawn by `avatar()`.
  - `.who` (avatar, name, `.who-title`) for a player on a board or a list, drawn by `who()`.
  - `.level-card` (with `up` for a new level), `.unlock` (a new achievement, a division reached, a week of the league ended),
    `.unlocks`/`.unlock-row` (what a game unlocked, drawn by `unlockPicture()`), `.next` (what comes next), `.badge-mark`.
  - `.achievements`/`.achievement` (and `locked`), `.medals`/`.medal` with `.medal-card` (Награди's grid), `.worn`
    (what's worn), `.picker`/`.pick` and `.tone-pick` for choosing a look.
  - `.league-link` (Профил's line of the league, a tap from the group).
- **Results:** `.summary`, `.board`/`.row` (with `p1`–`p3`, `me`, `gap` and `moves`), `.topics`/`.topic`,
  `.players` and `.settings`. Every result screen (the day, a topic, Втори шанс, a duel, a room) is laid out the same:
  the result; right under it what to do next (`nextSteps`): the one gold `big` button (the day's „Сподели“, „Още
  десет“, „Още един дуел“, „Нова игра“), then the others as plain buttons of one size, side by side where they fit
  (`.result-actions`: „Прегледай въпросите“ first); then the game's news; and at the end the questions, once
  opened (the button takes the player there).
- **Friends:** `.card.friends`, `.invitation` (a friend request, accepted with `.btn.rose`), `.friend-list`/`.friend`
  (with `.friend-day` and `.record`) and `.invite-link`.
- **In code:**
  - `ui.ts` has `verdict`, `fact`, `streak`, `stat`, `figure`, `meter` and `toneOf`.
  - `game/mastery.ts` has `masteryBadge`, `masteryCard` and `masteryMoves`.
  - `game/run.ts` has `trail`, `questionHead` and `timer`.
  - `game/results.ts` has `summary`, `nextSteps`, `review`/`reviewParts`, `board`, `boardRow` and `shareButton`.
- **Selectors:** give a part its own class (`.streak-num`) rather than a tag under a class (`.streak b`). Biome's
  `noDescendingSpecificity` flags the second kind. One class, one thing: a name already in `app.css` (`.back`, the
  way back; `.status`, a line of status) is taken, so a new part gets a name of its own (`.key.erase`, `.status-row`).
- **Test hooks:** the browser tests depend on these classes; keep them:
  - `.question-head`, `.options .option`, `.number`, `.keypad` and `.sortable-list`
  - `.up-next`, `.summary`, `.reviewed` and `.verdict`
  - `.players li`, `.friend`, `.invitation` and `.invite-link`
  - `.modes`, `.topics`, `.streak-chip`, `.level-chip` and `.league-card`
  - `.unlocks .unlock-row`

## Tiers

- **Four tiers of achievement**, each with its colour: обикновено (silver, `--tier-common`), рядко (sky,
  `--tier-rare`), епично (violet, `--tier-epic`) and легендарно (gold, `--tier-legendary`). Each has an `-ink`
  token for words. A `.t-<tier>` class sets `--tier` and `--tier-ink` for anything inside it.
- **Medals are pictures** (`badge-<tier>`, placed by `art/badge.ts`): the tier gives the form — common a round coin,
  rare a hexagon, epic an eight-pointed star, legendary a sunburst with ribbons — with a raised rim around a face in
  the tier's colour, where the achievement's own picture is drawn large (`medalPictures`, one per achievement). Epic
  and legendary glow. Locked: grey, with a ring for its progress. Hidden and not found: a „?“, and nothing about how
  or what it gives.
- Every achievement says how it's earned, how far along the player is, and its reward: its tier's XP, and only
  what it would unlock that the player doesn't have (an avatar shared by a chain is the first one's; what the first
  of a tier unlocks is said once, under the tier's heading). A title shows in its tier's ink wherever it's worn.
- **One system.** XP comes from answers, the day's goals, achievements and a week's first three places in the league;
  the rating from duels and Роял. Level, achievements, mastery, division, Роял and first place in a high league
  unlock the wardrobe. After a game, its news is three cards at most: the goals it finished; the one biggest event (a
  week of the league ended, a division
  reached, a new level), or else a line of the XP it brought and the level (`.news-xp`); and „Ново за теб“
  (`.unlocks`): achievements and everything newly unlocked, each unlock with „Сложи“, whatever unlocked it. Профил shows
  what comes next (`.next`); the day's goals, all three done, earn a reserve day for the streak (`.goals-reserve`,
  `.week li.saved`). Награди opens with „Как се печели“, the whole of it in five lines.
- **Division emblems** are pictures (`division-<id>`): a silhouette per division — Бронз a plain shield, Сребро a
  chevron, Злато wings, Платина a star, Диамант a cut gem, Легенда a crowned shield of stars with rays — in `--div-*`
  colours (`art/emblem.ts` places them).
- **Avatar frames** are pictures (`frame-<id>`) drawn around the rounded tile: Пръстен, Двоен пръстен (with gems),
  Точки (beads), Пламъци (a crest of flames), Лавров венец, Кристал (cut gems at the corners), Ореол (a sunburst), and
  the peaks for first place in a week of a high league (Връх Ботев, Връх Вихрен, Връх Мусала: Стара планина, Пирин,
  Рила; a faceted star on top and laurel below, in bronze, silver and gold);
  each frame's colour is its `.fr-*` tone. **Patterns** behind the picture are CSS (`.bd-dots`, `-stripes`, `-grid`,
  `-rays`, `-stars`). Both unlock by level, achievement or the highest division reached, and show on every avatar
  (the server sends a look's avatar as `shape-tone/frame/backdrop`).
- **League emblems** are pictures (`league-<tier>`): a mountain on a round of sky, rising with the league — Странджа's
  low wooded hills, Средна гора's ridge, Родопи's first peak, then Стара планина, Пирин and Рила in snow, a star over
  Рила — in `--lg-*` colours, green to ice (`art/league.ts` places them). In a group (`.league-board`) the ones going
  up and down are marked at the row's edge (`.row.up`, `.row.down`), with a line where each zone ends (`.league-line`).

## Flow

- **The game moves on by itself.** There is no „Напред“ anywhere: an answer shows for 3 seconds (4.5 where there's
  more to read: a number, an order), with a line filling under it, and the next question opens. A room shows each
  answer with its standings for 6 seconds; a live duel shows both answers for 4 seconds (6 for a number, an order or
  a match). A question never opens in a tab that's out of sight.
- **A game has the whole screen.** On a phone the bar of places steps aside while a question or its answer shows
  (the name at the top still goes home), so the pad and the verdict fit and a stray tap can't leave the game.
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

| Element      | Measures                                                                                                                                                                                                                                                                                                                                                                                                                      | Where                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Streak       | Days in a row with the day's ten; the strip is this week's days played (`week` in `/api/day` and `/api/me/stats`)                                                                                                                                                                                                                                                                                                             | Начало, Профил               |
| Points       | One game's score, per answer and per run, from the server (with the parts for speed and for the row); a right answer about 1000; never added up across games                                                                                                                                                                                                                                                                  | Verdict, result, day board   |
| In a row     | Right answers in a row within a game, from the second (the flame and „3 поред“); each earns a tenth more, up to a half                                                                                                                                                                                                                                                                                                        | Question head, verdict       |
| XP           | What knowing earns: 2 an answer and 18 more times its score (20 a right one), a finished game's 50 in the share answered right, 50 for the day's whatever the score, 50 to 150 a daily goal; adds up                                                                                                                                                                                                                          | Level, league, goals         |
| Place        | Place on the day's board („12-и от 318 днес“)                                                                                                                                                                                                                                                                                                                                                                                 | Начало, Класации, Профил     |
| Mastery      | Share of a topic's questions a player knows, from every answer weighed by its question's hardness (play/mastery.go); told after 10 answers, in six tiers: Новак, Любител (35%), Познавач (50%), Експерт (65%), Майстор (78%), Светило (90%)                                                                                                                                                                                   | Игра, Профил, result         |
| Rank change  | Places moved since the previous answer                                                                                                                                                                                                                                                                                                                                                                                        | Room boards                  |
| Duels        | Live with whoever comes (a recording of a real game if nobody does in 30 s), a friend in their own time: won of played; between two friends, their record („3 : 2“)                                                                                                                                                                                                                                                           | Дуел, Профил                 |
| Rating       | Elo from 1000, moved by duels and Роял; shown as a division (Бронз → Легенда) with its generated emblem                                                                                                                                                                                                                                                                                                                       | Дуел, Роял, Профил, Класации |
| Роял         | Live every evening at 21:00 (lobby from 20:45): up to 50 on the same question at once, 15 in three rounds; the first wrong answer is out, then watch                                                                                                                                                                                                                                                                          | Роял, Класации               |
| Goals        | Three a day, kept all day: the day's questions (50 XP), one drawn (100) and a harder one (150), of two families not drawn the day before, each one that can be done that day (Роял only while the evening's is ahead); each a link to where it's done, told at the game's end                                                                                                                                                 | Начало, result               |
| League       | A race every week (Monday to Sunday) on the XP earned, in a group of up to 20 of the player's league: Странджа, Средна гора, Родопи, Стара планина, Пирин, Рила. At the week's end the first go up (5 of a full group), the last go down, and the first three earn 300, 200 and 100 XP; first place in Рила is a title that counts („Двукратен шампион на Рила“)                                                              | Класации, Профил             |
| Boards       | The day's ten, the week's league group, rating (10 rated games or more) and knowledge (share right after 100 answers, or 30 in a topic), of everyone or of friends                                                                                                                                                                                                                                                            | Класации                     |
| Friends      | The day's board among you and your friends, once a friend has played                                                                                                                                                                                                                                                                                                                                                          | Класации                     |
| Level        | All the XP a player has earned; each level takes 150 more than the last (300 for the first)                                                                                                                                                                                                                                                                                                                                   | Начало, Профил, avatars      |
| Achievements | 19 facts of a player's games in four tiers (обикновени, редки, епични, легендарни), each saying how it's earned; announced once                                                                                                                                                                                                                                                                                               | Result, Профил               |
| Titles       | Words for the player and their knowledge, worn under their name, never only a deed: a ladder by level („Нова искра“ at 1 … „Жив алманах“ at 50), some achievements („Демон на скоростта“), a topic's mastery („Майстор · История“, „Светило · История“), and the rating and the league (divisions, a Роял won, Рила's champion counted). In their tier's colour; yours first, the locked ones by group with what unlocks them | Boards, friends, rooms       |
| Avatars      | A picture on a tone: nine animals free, emblems unlocked by achievements (the crown at level 10)                                                                                                                                                                                                                                                                                                                              | Everywhere a player is       |

Feedback fires once, when it's earned, and then the screen is still again:

- A right answer pops and glows.
- Points rise in gold, counting up to what was earned.
- An exact number answer gets the star.
- A wrong answer shakes once.

## Copy

- **Language:** standard Bulgarian (Bulgarian words, never Russian ones: see `CLAUDE.md`), to one player with „ти“,
  in short plain sentences. Text must be gender-neutral.
- **Bulgarian words, not loanwords,** when a plain Bulgarian word says the same: „връзка“ or „покана“, not „линк“;
  „потребителско име“, not „таг“; „часовник“, not „таймер“. A loanword stays only where Bulgarian has nothing else in
  common use („имейл“, „аватар“, „рейтинг“), and never as slang („вайб“, „чилвам“). `language.test.ts` knows the ones
  that have slipped in.
- **Buttons** are verbs: „Започни“, „Отговори“, „Още десет“.
- **Verdicts** are a fixed set: „Точно!“, „Вярно!“, „Близо.“, „Не е това.“ and „Времето изтече.“
- **Numbers the Bulgarian way:**
  - a space between thousands from 10 000 up („1380“, „12 500“);
  - a decimal comma;
  - a unit after a space („15 с“);
  - ordinals with the ending the dictionary gives (`lib/ordinal.ts`): „1-ви“, „2-ри“, „3-ти“, „4-ти“, „5-и“, „12-и“,
    „21-ви“, and „3-то място“;
  - months in lower case, also after a word („Алманах за ноември 2026“).
- **No emoji in the interface.** The one place they appear is the text a player shares of the day's result
  (`game/share.ts`: 🟩 right, 🟨 close, 🟥 wrong), which never shows on a screen.

## Motion

- **Timings:**
  - presses 120ms; hover and colour 160–200ms;
  - the right answer's pop 360ms; the wrong answer's shake 320ms;
  - the points' rise 520ms;
  - the timer runs linearly with the clock, and so does the ring of the three-second count before a topic's run
    (with „Започни сега“ and „Отказ“, so a tap on a topic never throws the player straight into a question).
- **No ambient motion** and no confetti.
- **Reduced motion:** under `prefers-reduced-motion` the pop, the shake, the rise and the transitions stop. The timer
  and the count before a run still move, because they are information.

## Sound

- **Tones made in the browser** (`web/src/lib/sound.ts`): there are no files to load. Each sound is a few notes,
  quiet, and over in under half a second.
- **One sound per moment**, and only for game moments:
  - `tap` when an answer is given;
  - `key` for each key of the number pad and each move in an order;
  - `right`, `exact`, `partial`, `wrong` or `time` with the verdict;
  - the clock while a question waits: `tick` and `tock` in turn each second, then `hurry` in each of the last five;
  - `tick` for each second of the count before a run;
  - `end` when a run's result opens;
  - `level`, `achievement` or `goal` with the news: only the biggest thing told plays;
  - `ping` when a game or a duel starts, or a friend calls to a duel.
- **Nothing plays** for navigation, hovering or decoration.
- **On by default**, with one switch in Профил („Звуци“) that's kept on the device. The audio starts on the
  player's first touch, as browsers require; a sound that isn't allowed yet is skipped, never queued.

## Pictures

The game's illustrations — the avatars, the topics, the ways to play, the frames, the division emblems, the leagues'
mountains and a medal — are drawn by hand as paths in `web/src/art/pictures.ts`, and placed with `picture(id)` from
`art/picture.ts`. They load as a file of their own once the game starts, so the first screen never waits for them.

- **One style:** flat shapes with depth, no outlines, lit from the top left. Depth comes from a lit half and a shaded
  half, a soft shadow set down and right (`lift`), and a light on the top-left edge, never from gradients.
- **One ramp:** a picture is painted from one tone — the topic's, the avatar's, the mode's, the frame's, the tier's —
  in its inks: `k0` night ink, `k1` deep, `k2` shade, `k3` the tone, `k4` light, `k5` pale, `kw` white; `ks` a shadow
  and `kh` a light laid over, `kt` a tint of the tone for a ground; `l0`–`l5` the same inks as strokes. `.pic` in
  `app.css` mixes them from `--tone`, so a picture follows its tone and the theme with no colour of its own.
- **On a tile or on a card:** an avatar is painted over a tile in its tone (`k3`), so it uses the darker and lighter
  inks; a topic or a mode stands on a soft disc of its tone (`kt`) over the card, so the tone itself is its main
  colour.
- **Art, not rules:** the pictures are a library the game draws from; what unlocks what is the game's rule
  (`internal/play`), and a picture never changes it. The library holds more than the game shows today, ready for
  when it wants them.
- **What there is:** nine animals everyone has as avatars (лисица, мечка, котка, заек, таралеж, куче, елен, щъркел,
  жаба) and six more drawn for later (катерица, рис, язовец, овца, костенурка, мишка), portraits cut at the tile's
  bottom; the emblems achievements unlock as avatars, and the crown of level 10; a picture for every achievement's
  medal, growing within a family (a flame, a torch, a bonfire, a phoenix for the streaks; a book, then a pile of
  books; a shield, a shield with swords, a Thracian helmet; a heart, three hearts, a chess knight; a trophy, a
  scholar's cap, a wreath); a picture per topic (a bulb, a flask, an amphora, a globe, a clapperboard, a record, a
  ball, a gamepad, a quill in its inkwell, a butterfly), on its tile and, small, on its chips; one per way to play
  (crossed swords, a crown in laurel, an open door) on its card and over its page, and over Приятели (three
  hearts) and Моят Алманах (a book); the streak's flame; the frames, the divisions' crests, the leagues' mountains and
  the achievements' medals.
- **A new picture** is drawn on the 64 × 64 grid in the same inks and looked at beside the others, at its smallest
  size (an avatar at 28px) and in both themes, before it ships.

## Icons and the logo

- **Icons:** no icon font and no emoji. Icons are CSS masks drawn in `currentColor`: `--i-check`, `--i-cross`,
  `--i-near`, `--i-clock`, `--i-star`, `--i-up`, `--i-down`, `--i-flame`, `--i-left` (back) and `--i-tune`
  (Настройки). A new icon is a 24px drawing with 3px round strokes, added the same way. The four places' icons
  (`--i-home`, `--i-users`, `--i-podium`, `--i-user`) also have a soft fill inside (the mask at a third of its
  strength), and Профил's is an avatar's tile.
- **The logo** is the rosette (`web/public/favicon.svg`): four petals on the ink tile, one gold. Use it as it is.
  The header shows it at 32px with a 1px `--line` ring, beside „АЛМАНАХ“ at 900 weight with 0.12em tracking.
- **Share images:** `web/public/og.png` and `.github/social-preview.png` are drawn in the same style.

## Before a UI change ships

- **Look at it** in both themes, at 320px and 390px wide. Nothing may scroll sideways, and keyboard focus must show.
- **Run the checks:** `npm run check`, then the browser tests (`npm run e2e`), which include the accessibility
  checks.
- **Keep to the budgets:** 14 kB of CSS, 40 kB of JS and 24 kB of pictures, gzipped. `go run ./cmd/build` fails
  over them.
