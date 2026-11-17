# Design

АЛМАНАХ looks like a modern magazine that keeps score: Night first, gold for the one right answer, numbers as the
heroes, and game feel drawn only from what the game really counts. This file holds the rules. The values live in
`web/src/app.css` (the tokens at its top), and the pieces several screens share live in `web/src/ui.ts`. Follow all
three when you add or change a screen.

## Principles

- **One obvious action per screen**, and it is the gold button: `.btn.primary`, plus `big` for a screen's main
  action. Everything else is a plain `.btn` or a `.link`.
- **Gold means the one right answer**, as in the logo: the primary action, the current game's progress (the
  clock's last ten seconds, the current pip), the streak, and reward just earned (points, first place, an exact
  answer). Nothing else: where the player is takes the accent, levels lilac, XP in a list muted, and nothing is
  gold for decoration.
- **Numbers are the heroes.** Scores, places, the streak, the timer and room codes use the numeral face, with
  tabular figures.
- **Game feel comes only from data the game has** (see Game feel below). No currencies, shops or made-up numbers:
  the level is the XP a player has really earned by playing, and every achievement is a fact of their games.
- **Few taps.** Every game starts one tap from Начало (the count before a topic's run starts by itself). A screen
  shows what it's for first and its details after, and folds away what's rarely needed (locked titles, hidden
  achievements) instead of listing it.
- **Phone first.** The layout is one column, at most 40rem wide, with a 16px gutter. Every screen fits a 320px phone
  without scrolling sideways.
- **A big screen uses its width** (see Wide screens), and never changes how a phone looks: its rules live in
  `min-width` blocks.

## Places

Four main places, in a bar at the bottom of a phone (in the header on a big screen). Nothing else goes in the bar.

- **Начало** (`/`): the day first. The streak and the level side by side (each a way to Профил); the day's ten as the
  day's issue (`.masthead`: the weekday and „Брой 6“ on a hairline, the date set large, „17 ноември“, a hairline
  under it; then „Десет въпроса за днес“ a size down, what they are, and „Започни“; no pips before play: they'd
  measure nothing yet). The issue is the day's number from the first day of the day's ten (`play/issue.go`, 12
  November 2026 is Брой 1), the same for everyone. Left half-way, the same card with where the player stopped,
  „Следва въпрос 4 от 10“, the pips so far, and „Продължи“; or once played, how they went (under the score the issue
  line, „Брой 6 · 17 ноември“, and the place a way to the day's board) with „Сподели“, the gold button, right under it
  and „Прегледай въпросите“ below, then tomorrow in one quiet card (`.tomorrow`: when the next ten come, what they make
  of the streak, and the reminder's ask) before the friends' day and the game's news; the day's goals; the ways to play with others, three in a row (the picture over
  the name on a phone); the topics, two by two (five to a row on a big screen, the picture over the name, each tile
  as tall as what's in it), and all of them at once (on a big screen in one row after the topics with „България“ and
  „Втори шанс“, short tiles side by side). Дуел, Роял and Стая open from here and
  have a way back to it (`back()`). A player who hasn't finished a game yet sees only the day and the topics, and a
  quiet „Имаш профил? Влез“ (a new phone) that opens the sign-in in place (open from the start, above the day, for a
  browser signed out that came from the streak's mail, `/?from=mail`): the
  streak and the ways to play with others come after the first game, the level and the goals from the second day
  played (see First days). From the second day played, a guest is asked to keep the game in one line of the „Утре“
  card, said by what's at stake („Серията ти от 2 дни е само на това устройство. Запази я с имейл.“), the form opening
  in place. In an app's own browser (Messenger, Instagram …: `lib/embedded.ts`), where a guest's game would stay, it's
  asked on the first day, with the way out that carries the game: „Отвори в браузъра“ on Android, „Копирай връзката“
  (for Safari) on an iPhone (`/hand/<token>`, once, `account.Handoff`). A guest's Профил has „Играеш и на друго
  устройство? Влез с имейла си“ under the name.
- **The streak at stake.** While the day's ten wait, a streak (1 day or more: the second day is where a habit is won or
  lost) is at stake: its flame is unlit (`.streak-chip.unlit`, the number still there), and the day's card says what
  the ten make of it („Серия от 5 дни. С днешните въпроси става 6.“); from 18:00, if no reserve day would keep it, that
  it ends („Серия от 5 дни. Прекъсва в полунощ, ако не изиграеш днешните.“, `.day-stake`). The day played lights the
  flame as its number rolls on (Motion). A topic's result, while the day waits, has „Към въпросите на деня“ as its gold
  button, the same line under it, and „Още десет“ plain.
- **Приятели** (`/friends`): requests, friends, and the ways to add them. With none yet, „Покани с връзка“ is the gold
  button, first (the phone's share sheet, or „Копирано.“: the address itself is never printed), the field by
  потребителско име or имейл under it with „Добави“.
- **Класации** (`/ranks`): Днес (the day's board, first), Лига (the player's group this week; `/ranks#league`),
  Рейтинг and Знания (Лига and Рейтинг once the player has met them); of everyone or of friends (not the league: a group is its own).
- **Профил** (`/me`): its own four places in a switch at the top (`profileNav()`): Общо (the player: level,
  league (once open and in one), streak, numbers, the facts in the Алманах, mastery (once a topic has a mark), latest games), Награди (`/rewards`, the achievements), Гардероб (`/wardrobe`: what's
  worn as others see it, then Аватар, Рамка, Фон or Титла, one at a time) and Алманах (`/almanac`). Настройки open
  from the icon beside the name. The switch names the place, so Награди, Гардероб and Алманах have no heading of
  their own on the screen (it's there for screen readers).
  **Моят Алманах** reads as an almanac, by day, newest first: the count in the numeral face („42 факта досега“, or a
  topic's „7 от 24 факта в „История““), what they are in a line, and the questions waiting for a second chance as one
  plain link („17 въпроса чакат втори шанс“: Начало has its tile too); the topics as a quiet row of chips (names
  only) to read one by; then each day under its dateline (`.almanac-date`: „Брой 6 · 17 ноември“, a kicker running
  into a hairline, with the year once it isn't this one), its facts as entries between hairlines, not cards: the
  topic, the question in a small line, what was learned as the headline (the answer; a statement to judge is its
  own headline, „Невярно:“ before one that isn't so), and the fact. It comes a page at a time, a day going on under
  its head from page to page.
  Общо is a hub, each thing once: the level with what comes next in one card, the league in a line (its group is
  Класации'), the streak, three numbers in one card, the Алманах in a line („N факта в Алманаха“, a tap from it), mastery,
  the latest games. Награди opens with the three
  achievements nearest to done and the earned ones, each in full (`.achievements`/`.achievement`: how it's earned,
  how far along, what it gives); the rest by tier behind „Всички постижения (n)“. Only the achievements of systems
  the player has met, and no XP before it's open.

## First days

The game unfolds: a new player meets its systems one at a time, as each starts to matter, by what they've done (days
played, a rated game), never by the date. The server says which are open (`open`, from `play/unfold.go`, in
`/api/day`, `/api/me/progress` and a game's news); a screen shows nothing of a system that isn't, and doesn't name it.

- **The first day:** the day's result and its points, the streak, the topics, the ways to play with others, and the
  achievements the day earned with what they unlock (but what a level unlocks). No XP, level, goals, league or
  rating anywhere.
- **The second day played:** XP, the level (Начало's chip, Профил's card, the avatar's number) and the day's goals.
- **The third:** the week's league (Профил's line, Класации' „Лига“). A week that ended before is let go untold.
- **The first duel or Роял that moves the rating:** the rating and its division (Дуел, Роял, Класации' „Рейтинг“).
- **Роял, while its evenings are thin** (the median of the last 7 under 8 players): in a player's first 7 days it
  isn't among „С други“ on Начало, nor a goal, until they've found it (been in one, or said „Ще дойда“). A first live
  game that feels empty teaches that nobody plays it (`play.NudgeRoyal`).
- **A topic's first estimate** (10 answers): „Колко знаеш“ on Профил, the topic's tile and a game's news say
  „първа оценка · 74%“, a share and no tier; the tier („Експерт“) comes with a sure mark (30 answers).

Nothing earned waits, only what's shown: XP, achievements and unlocks count from the first game, and what was held
(a level reached, its unlocks, an achievement of the goals or the league) is told when its system opens. Each system
is said once, as it opens, in one quiet line at the top of that game's news (`.news-open`), never a tour.

**The three numbers** are kept apart (`play/worth.go`) and each says what it is where it first shows, and a tap from
wherever it does (`explain()`: the word dotted under, its meaning in a small card over the page; the words are
`meaning` in `ui.ts`):

- **точки:** one game's score (right answers, speed, right in a row); the day's board is by them, and the week's
  league by the day's, added up;
- **XP:** what playing earns (games, goals, achievements); it adds up to the level;
- **рейтинг:** strength in duels and Роял, up with a win, down with a loss; the division is by it.

## Space and size

- **Spacing** comes from the scale (`--space-1` … `--space-7`: 4, 8, 12, 16, 24, 32, 48): 24 between a screen's
  sections, 16 inside a card and between a section's title and what it heads, 8 between tiles of one grid.
- **Cards** have 16 of padding (`.card`), the hero 20.
- **Tiles** (a way to play, a topic) are a picture at 44–48px beside the name, at least 68px high, two to a row.
- **Touch targets** are at least 44px high; the bar's are its full height.

## Wide screens

- **48rem (a tablet):** the column grows to 48rem; the places move into the header; in a game the question and its
  answers are bigger, and a choice's answers sit two by two (a list stays one column: an order, pairs, groups). The
  number's field and pad stay a phone's width. A page's picture sits beside its heading and lead, not over them;
  the day's gold button and a page's own are a hand's width (22rem), not the column's.
- **64rem (a laptop):** the page is up to 76rem wide with a 32px gutter. Начало is two columns: the day (or its result,
  „Сподели“ beside „Прегледай въпросите“), and under it the topics, five to a row; beside them, at most 22rem wide,
  the streak and the level, the goals and the ways to play with others, one under another. A new player, with only
  the day and the topics, gets one centred column. Профил's places are 64rem wide: Общо's cards in two columns, read
  top to bottom; more achievements and bigger looks to a row. Every other page is a centred column of 48rem, so no
  line of text runs too long; a game is 54rem, with bigger type still.
- **A computer** (a fine pointer that hovers) is shown its keys: the answers are marked 1–4 instead of А–Г (the keys
  that give them, the same on every keyboard layout), „Вярно“ and „Невярно“ 1 and 2, the count before a run Enter
  („Започни сега“) and Esc („Откажи“), and an answer shown Enter (on at once). The marks are `.key-hint`.

## Colour

Night is on `:root`; Day replaces it under `prefers-color-scheme: light`. A rule never holds a literal colour: it
takes a token.

- **Grounds, back to front:** `--bg` (the page), `--surface` (cards that hold information), `--hero` (the one hero
  card: the surface in Night, a warm white in Day, so the day outranks the tiles), `--raised` (things you press:
  buttons, answers) and `--sunken` (tracks, wells, inputs, a question not played yet). Set them apart with depth
  (`--elev-1`, `--elev-2`) and `--line`, not with borders; an answer's edge is `--edge` (the line in Night, stronger
  in Day, where white answers sit on a light page).
- **Text:** `--text` and `--text-muted`. Links, focus and the player's own choice use `--accent` (`--link`).
- **Fills:** `--gold`, `--lilac`, `--right`, `--wrong`, `--sky`, `--rose`, `--silver` and `--bronze`, always with
  `--on-fill` text on them. A meaning set as text uses its `-ink` twin: `--gold-ink`, `--right-ink`, `--wrong-ink`,
  `--sky-ink` or `--rose-ink`. Gold as a big number (24px and up, or 22px bold: the streak, points just earned, the
  winner's score) and as the time bar is `--gold-display`: gold in both themes, where `--gold-ink`, made for small
  words, turns brown in Day.
- **What each colour means:**
  - `gold`: the one right answer (see Principles).
  - `accent`: where the player is (the place in the bar, a line under it in the header, never a glow), their own
    choice, the day's goals (their bars and marks).
  - `right`: a right answer.
  - `wrong`: a wrong answer, the last five seconds, deleting.
  - `rose`: duels and friends (an invitation to a duel, the record between two friends).
  - `sky`: rooms.
  - `lilac`: levels: the level's bars, the chip's and Профил's, and the level's disc on an avatar (`.lv`).
  - `silver` and `bronze`: second and third place.
- **Topics** keep one colour everywhere: `toneOf(category)` in `ui.ts` gives gold, lilac, sky, rose or mint, in
  the bank's order. Each also has its picture (see Pictures).
- **Right, close and wrong never rest on hue alone.** Each also gets ✓, ∼ or ✕, the word, and a filled or hollow
  mark. Wherever they're marked after the moment (the pips of a run, a result, Начало's day played, a duel's marks,
  the review), they look as the shared text has them (🟩 🟨 ⬜): right filled in `--right` with ✓, the strongest; close
  hollow, a `--gold-ink` ring with ∼; wrong quiet, the `--sunken` of a question not played yet with a muted ✕. The red
  is the answer card's, in the moment, and the verdict's. „Вярно или невярно“ is the one exception on the answers themselves: a ✓ or ✕ on „Вярно“ and „Невярно“ reads
  as the answer's own word, so they have none, before or after; the verdict under them carries the mark and the word,
  and gone over later (a review, a live game's answer), the right one says „верният отговор“ under its word.
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
  - The question (`.ask`) 28/34 (24/30 at 320px), 700 weight.
  - Body 16/24; `.lead` 18/26 in muted.
  - `.kicker` 12px, 800 weight, capitals with 0.14em tracking, for the date, the topic and section titles.
  - The day's date on Начало (`.masthead-date`) 44px (56px on wide screens), 800 weight: the one place words are set
    this large, as an issue's dateline.
- **Numerals:** 120px for the result, 36px for the question count, 52px for stats and the streak, 32px for figures
  and points, 72px for Роял's start. The numeral face is for digits only: Cyrillic words read badly in it at display
  size. A word beside a big number („Ниво“ 4, 7 „от“ 10, a board's „точки“) is in the words' face, small, muted, on
  the number's baseline (`.num-word`, `.sub`; `levelNumber()` in `ui.ts`).
- **Case:** sentence case everywhere. Capitals come only through `.kicker` and `.tag`.

## Shape and depth

- **Radii:** `--radius-md` for buttons, answers and inputs; `--radius-lg` for cards; `--radius-xl` for the one hero
  card; `--radius-full` for tracks, pills and place discs; `--radius-xs` for trail pips and a question's picture (a
  flag's corners stay square).
- **Depth:** `--elev-1` at rest, `--elev-2` on hover or for the hero card.
- **Glows are rewards:** `--glow-gold` on the primary button, first place and an exact answer; `--glow-right` on a
  right answer. Nothing else glows: not the place in the bar, not a level.
- **Focus:** one rule for everything (`:focus-visible`): a 2px `--accent` outline, 2px off the edge. An outline
  follows the corners and no component's own shadow can cover it, so a component never sets its own.

## The pieces

- **Layout:** `.screen`, `.stack`, `.intro`, `.title-row`, `.card` (with `.card-head` and `.card-title`) and
  `.card.hero`.
- **Getting around:** `.tabs` (the four places), `.back` (drawn by `back()`), `.subnav` (Профил's places, drawn by
  `profileNav()`), `.icon-btn` (a square with an icon and its name for screen readers) and `.more` (a `details` that
  folds what's rarely needed; what it holds is spaced as a section's parts).
- **Начало:** `.status` with `.streak-chip` and `.level-chip`; `.card.hero.day` opening with `.masthead`
  (`.masthead-line`, `.masthead-date`) over `.day-title`; `.modes .mode` and `.topics .topic` (`.topic-all` across
  the row).
- **Моят Алманах:** `.almanac-head` (`.almanac-count` with `.almanac-n`, and `.second-chance`), `.almanac-topics`,
  `.almanac-day` with `.almanac-date` and `.almanac-list`, each `.almanac-item` (`.almanac-topic`, `.almanac-q`,
  `.almanac-a`, `.almanac-untrue`, `.almanac-fact`).
- **Page openers** lead with the thing, not its rules: Роял's next evening is its start in big numerals
  (`.royal-when`), the time to it under it (`.royal-countdown`) and „Ще дойда“ gold, the rules folded in „Как се
  играе“; the league's card says the week as it stands (`.league-now`: „Още 6 дни · първите 5 се качват“, and the
  gap worth playing for, `.league-gap`: „До 3-то място: 300 точки.“, „Водиш с 120 точки.“, „Още 80 точки и излизаш
  от зоната за слизане.“), its rules folded in „Как работи лигата“ (open the first time, on that device). A lead is
  one sentence.
- **Text:** `.kicker`, `.lead`, `.muted`, `.small`, `.bad` (errors) and `.status`; `.explain` with `.explain-pop`
  (a number's name, a tap from its meaning: `explain()`).
- **Controls:**
  - `.btn`, with `primary`, `big`, `rose` (accepting a friend request), `danger` and `inline`, all with one corner
    (`--radius-md`); and `.link` (`tap` for one on its own line, a finger's height).
  - Like things are one size: a field is a button's height (48), an answer row 60 whatever the question's kind, a
    meter 6, a row card 12 by 16 inside; every number of a size is from the scale.
  - `.field` and `input.code`; `.join` for an input with its button.
  - `.segmented` (`segmented()` in `ui.ts`): tabs that switch what a screen shows, or, as radios, a setting's few
    choices (a room's „Въпроси“ and „Трудност“). Never a native select, radio or checkbox.
  - `.tag` and `.chip`; `.chips.scroll` for a row of chips that scrolls sideways on a phone (the page itself never does);
    with a mouse or on a tablet and up it wraps, every chip in sight.
- **Numbers:** `.figures`/`.figure`, `.stats`/`.stat`, `.streak` (with `.week`), `.games`/`.game`.
- **Mastery:** `.mastery` (the tier's bars, lit in the topic's tone, and its name), `.mastery-list`/`.mastery-row`, and
  `.mastery-line` (how a topic's game moved it) in a result's „Ново за теб“.
- **Play:**
  - `.question-head` (with `.count`, which never wraps; `.versus`, the friend in a duel with one; and `.game-leave`,
    the way out on a phone), `.leave-ask` (asked to leave while the time runs), `.trail`, `.timer` (muted while
    there's time, `.soon` gold for the last ten seconds of a question longer than ten, `.low` red for the last five,
    `.stopped` grey once answered) and `.ask`; in a run, `.question-top` holds the head, the pips and the clock, and
    on a phone `.answering` is set at the foot and `.after` (the answer: verdict, fact, „Напред“) docks under it.
  - `.picture` over a question, its box the picture's own (no wider than the column), a hairline `--line` inside its
    edge so a white flag holds on a white card, on `--sunken` while it loads: while it's asked, `picture(view, true)` keeps it low enough for the question, the
    picture and the whole answering part to fit on the screen (no less than 128px); a question's time starts once
    its pictures are in.
  - `.options .option`, with the states `picked`, `placed`, `right`, `wrong` and `dim`; and `missed`, a row of a right
    answer the player didn't have (an order, pairs, groups): plain, with a hollow ✕ and „ти: …“ for what they gave.
  - „Раздели“: `.split` with `.split-deck` (the thing now on a `.split-card`, the next one `under` it; dragged, it
    names the group it's going to), `.split-sides` (the two groups as `.option.split-side`), `.split-pips` and
    `.split-back`; afterwards `.split-result`.
  - A choice of pictures: `.options.pic-options` (two by two), each `.option.pic-option` a picture with its letter
    (`.pic-letter`) and, once answered, its name (`.pic-name`); the pictures' credits in `.pic-credits`.
  - „Подсказки“: `.clues`, a `.clue` per clue with what a right answer is worth then (`.clue-worth`); the last one
    out is `now` (a gold edge: progress), the ones before it `past`, the ones to come `locked` (counting down).
  - How everyone else answered, once a question has enough answers: `.option.crowd` (a bar behind an answer as long
    as the share of players who gave it, the share beside it), `.spread` (where a number's guesses fell, the answer's
    part in `--right`, the player's in `--accent`) and `.crowd-says` (one quiet sentence under the verdict, or under
    the answer in a review, `crowdLine()`: the share right, of the day's players today for the day's ten; `.rare`,
    in `--gold-ink`, for a right answer a quarter or fewer got).
  - `.verdict` and `.fact` (`fact()`: „Знаеше ли?“ in Literata; for a question of the day's ten dealt on its own
    date, `.fact-day` heads the same card, „На този ден“ and what happened that day in plain type, a hairline under
    it, the „?“ moving down to the fact. Only with the answer, never before it, never in a topic's game).
- **Progress:**
  - `.avatar` (a picture on a tile of its tone `tone-…`, sizes `s` and `l`, the level in `.lv`), drawn by `avatar()`.
  - `.who` (avatar, name, `.who-title`) for a player on a board or a list, drawn by `who()`.
  - `.level-card` (with `up` for a new level), `.unlock` (a new achievement, a division reached, a week of the league ended),
    `.unlocks`/`.unlock-row` (what a game unlocked, drawn by `unlockPicture()`), `.next` (what comes next), `.badge-mark`.
  - `.achievements`/`.achievement` (and `locked`), `.worn`
    (what's worn), `.picker`/`.pick` and `.tone-pick` for choosing a look.
  - `.place-link` (a line in Профил a tap from a place: the league's group, `.league-link` too; the Алманах).
- **Results:** `.summary`, `.board`/`.row` (with `p1`–`p3`, `me`, `gap` and `moves`), `.topics`/`.topic`,
  `.players` and `.settings`. Every result screen (the day, a topic, Втори шанс, a duel, a room) is laid out the same:
  the result; right under it what to do next (`nextSteps`): the one gold `big` button (the day's „Сподели“, „Още
  десет“, „Още един дуел“, „Нова игра“), then the others as plain buttons of one size, side by side where they fit
  (`.result-actions`: „Прегледай въпросите“ first); then the game's news; and at the end the questions, once
  opened (the button takes the player there). Each question gone over is a card of its own (`.reviewed`, a band in
  its verdict's colour on top): its number and topic as a kicker with „Вярно“, „Близо“ or „Грешно“ beside them, the
  question the strongest line, the answers marked, and the fact a quiet note under them.
- **A room led from a big screen** (`host.css`, loaded only there): `.host`, `.host-row` (two columns on a laptop and
  up), `.host-qr`, `.host-join`, `.host-controls` and `.podium`.
- **A duel's result** (`screens/outcome.ts` with `outcome.css`, loaded as a duel starts), one card (`.duel-end`) for
  a result or a friend's duel still waiting: the kicker („Дуел с Мария“, „Дуел на живо с …“, „Дуел срещу запис“)
  and the verdict (`.duel-verdict`: „Победа“, „Загуба“, „Равенство“, „Изигра своя дуел“); the two face to face
  (`.duel-face`: the big avatar with its frame, the name a way to the profile, the title or „Запис“, the points and
  the right answers; the winner's points gold and its avatar glowing, the other's plain; the other's points a dash,
  „Тепърва ще играе“, until they have; under a person met in a live duel, not a friend yet, „Добави в приятели“,
  `.duel-add`); the duel question by question (`.duel-marks`: the player's row over the
  other's, each beside a small avatar; the quicker of two right answers ringed in gold, `.fast`, said once under
  them; a gold band behind the question that decided it); one line of what decided it (`.duel-line`: „Реши се на
  8-ия въпрос.“, „Реши се на последния въпрос.“, „Мария водеше от първия въпрос до края.“, „Равни точки: реши
  времето (…)“; one who left a live duel under way, „Мария излезе след 4-тия въпрос.“; while waiting, until when, the
  weekday in full); and what it meant under a hairline (`.duel-meant`: the division's emblem,
  its name and the change, its bar, „Рейтинг 1062 → 1080 · 70 до Злато“; why it didn't move; the record against
  this person, „Срещу Мария 3 : 2“, in rose). Then the next steps: „Реванш“, gold (a friend's; or right after a
  live one against a person: the other sees „Мария иска реванш.“ over theirs, `.rematch-asks`, and has 15 seconds to
  ask too), with „Още един дуел“ beside it; „Още един дуел“ gold after one against a recording; else „Към дуелите“. A duel without a result (turned down, not played in time, cut off) is
  its heading and a line, and the player's own game if they played it (`.duel-mine`).
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
  - `.unlocks .unlock-row`, `.news-open` and `.explain`
  - `.duel-head`, `.duel-verdict`, `.duel-face`, `.duel-points`, `.duel-marks .duel-pip`, `.duel-line`,
    `.duel-rating-line` and `.duel-record`

## Tiers

- **Four tiers of achievement**, each with its colour: обикновено (silver, `--tier-common`: a cool metal, never the
  grey of what's locked), рядко (sky, `--tier-rare`), епично (violet, `--tier-epic`) and легендарно (gold,
  `--tier-legendary`). Each has an `-ink` token for words. A `.t-<tier>` class sets `--tier` and `--tier-ink` for
  anything inside it.
- **Medals are pictures** (`badge-<tier>`, placed by `art/badge.ts`): the tier gives the form — common a round coin,
  rare a hexagon, epic an eight-pointed star, legendary a sunburst with ribbons — with a raised rim around a face in
  the tier's colour, where the achievement's own picture is drawn large (`medalPictures`, one per achievement). Epic
  and legendary glow. Locked: grey (`--locked`, pale in Day); its progress is the bar beside it, never a ring around the medal. Hidden and not found: a „?“, and nothing about how
  or what it gives.
- Every achievement says how it's earned, how far along the player is, and its reward: its tier's XP, and only
  what it would unlock that the player doesn't have (an avatar shared by a chain is the first one's; what the first
  of a tier unlocks is said once, under the tier's heading). A title shows in its tier's ink wherever it's worn; as
  an unlock it's drawn as a ribbon with a nameplate in its tier's colour (`.unlock-title-mark`).
- **One system.** XP comes from answers, the day's goals, achievements and a week's first three places in the league;
  the rating from duels and Роял. Level, achievements, mastery, division, Роял and first place in a high league
  unlock the wardrobe. After a game, its news is three cards at most, of what the player has met (First days), under a
  line for a system met with it (`.news-open`): the goals it finished; the one biggest event (a
  week of the league ended, a division
  reached, a new level), or else a line of the XP it brought and the level (`.news-xp`); and „Ново за теб“
  (`.unlocks`): achievements and everything newly unlocked, each unlock with „Сложи“, whatever unlocked it, three
  rows at most, the highest tier first, the rest in one line („Още 4 в Награди“, or „в гардероба“ when it's only
  things to wear). An achievement's row says its tier in the tier's ink and only its XP in gold. What
  really is big is also brought forward in a sheet over the result (Motion). Профил shows
  what comes next (`.next`); reserve days keep the streak (the first day, every seventh in a row and a day with all
  three goals earn one: `.goals-reserve`, `.week li.saved`); a day a reserve kept, or a streak that ended, is said
  once on Начало (`.streak-notice`), as is, one at a time, what others did meanwhile: a friend played the duel, said yes
  to an invite („Мария прие поканата ти.“ and „Дуел“), or a live duel left went on without the player. Награди opens with „Как се печели“, the whole of it in five lines.
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
  wooded hills (up to two thirds of a round of its own tint, as a topic stands on: under a pale sky its low hills
  left an empty disc), Средна гора's ridge, Родопи's first peak, then Стара планина, Пирин and Рила in snow, a star over
  Рила — in `--lg-*` colours, green to ice (`art/league.ts` places them). In a group (`.league-board`) the ones going
  up and down are marked at the row's edge (`.row.up`, `.row.down`), with a line where each zone ends (`.league-line`).

## Flow

- **The game moves on by itself, and a tap moves it on sooner.** Alone (the day, a topic, a friend's duel), an answer
  shows in steps: the answer marked, the verdict with its points, then its fact („Знаеше ли?“), at the moment the
  player most wants it. It stays 3 seconds (4.5 for anything but a choice or „Вярно или невярно“: there's more to
  look at) and the time to read the fact and the day's line (1.2 seconds and a little for each letter, 9 at most),
  with a line filling as it waits; „Напред“, always there (Enter on a computer; „Към резултата“ after the last), goes
  on at once. A room shows each answer with its standings for 6 seconds (a host who leads it from a big screen, „Само водя“, has „Напред“, „Задръж“ and
  „Край“, and the fact with the answer: a class talks it over); Роял the same, 10 seconds with a cut; a live duel
  shows both answers for 4 seconds (6 for anything but a choice or „Вярно или невярно“). A question never opens in a
  tab that's out of sight.
- **A game has the whole screen.** On a phone the header and the bar of places step aside from the count before a
  run, and while a question or its answer shows (an arrow before the count goes home), so the pad and the verdict fit
  and a stray tap can't leave the game. Each question opens at the top of the page.
- **On a phone, the answers are at the thumb.** A run's question is a column the screen's height: the head, the pips
  and the clock at the top (kept there as the page scrolls), the question under them, and what answers it at the
  foot — the answers, „Вярно“ and „Невярно“, the pad with „Отговори“, „Готово“ (which stays at hand on a screen too
  short for the rest). The answer docks at the screen's foot, always in the same place: the verdict, how everyone
  answered, the fact (scrolling on its own when it's long) and „Напред“ across the width; the answers move up above
  it, marked, and the page moves only when they can't all fit, just enough to show the right one. A big screen shows
  the answer under the question, as before.
- **Leaving a game is free between two questions.** While a question's time runs (on the server, so it can't wait),
  a way out — the arrow, a place in the header — asks first („Ако излезеш сега, въпросът остава без отговор.“,
  „Остани“ or „Излез“), and leaving gives that question up. The game waits where it stopped: the day on Начало with
  „Продължи“, a topic's game for the next tap on that topic the same day. No question's time starts without a tap;
  only a reload with one showing goes straight back into it.
- **What isn't the answer waits for the end.** „Нещо не е наред с въпроса?“ is in the review after the last answer
  (of a run, a duel, a room or Роял), never between questions; so are the facts of a game played with others, where
  the clock is shared and nobody can stop to read.
- **Time:** 20 seconds a question, 10 for „Вярно или невярно“, 30 for the ones with more to do: an order, „Свържи“,
  „Раздели“ and „Подсказки“. A question with pictures starts its time once they're in (it waits 8 seconds at most). When the
  time runs out, whatever has been put in (a typed number, things moved into an order, pairs joined, things sent to
  a side) is the answer.
- **Input without the phone's keyboard:** a number is typed on the game's own pad (a comma only where the answer may
  have decimals, a minus only for temperatures); things to order are tapped (one picked up, then its place), dragged
  into place (by the grip on a touch screen, so the rest of a row scrolls the page) or moved with the arrow keys.
- **A screen reader plays too.** Each question takes the focus as it opens; an answer chosen keeps it
  (`aria-disabled`, not `disabled`, once answered), and where the answering part goes (a pad, a list) „Напред“ takes
  it. A run has one live region, there from its start: it says each verdict once in plain words („Не е това. Вярно
  е: Бийтълс.“, „Вярно! +1040 точки.“) and each clue as it comes, never a countdown.
- **Touch:** no grey flash on a tap; an answer gives under the finger (98%, the accent edge); hover lifts only where
  a pointer hovers, so on a phone no answer looks chosen after a tap. Small drawn controls (the arrow out of a stuck
  head, „Върни последното“, an order's grip) still have 44px to tap.

## Game feel

Every element that looks like a game measures something the game already counts:

| Element      | Measures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Where                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Streak       | Days in a row with the day's ten; the strip is this week's days played (`week` in `/api/day` and `/api/me/stats`)                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Начало, Профил               |
| Points       | One game's score, per answer and per run, from the server (with the parts for speed and for the row); a right answer about 1000; never added up across games                                                                                                                                                                                                                                                                                                                                                                                                            | Verdict, result, day board   |
| In a row     | Right answers in a row within a game, from the second (the flame and „3 поред“); each earns a tenth more, up to a half                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Question head, verdict       |
| XP           | What knowing earns: 2 an answer and 18 more times its score (20 a right one), a finished game's 50 in the share answered right, 50 for the day's whatever the score, 50 to 150 a daily goal; adds up; muted in a list, never gold                                                                                                                                                                                                                                                                                                                                       | Level, goals                 |
| Place        | Place on the day's board („12-и от 318 днес“)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Начало, Класации, Профил     |
| Mastery      | Share of a topic's questions a player knows, from every answer weighed by its question's hardness (play/mastery.go); told after 10 answers, in six tiers: Новак, Любител (35%), Познавач (50%), Експерт (65%), Майстор (78%), Светило (90%)                                                                                                                                                                                                                                                                                                                             | Игра, Профил, result         |
| Rank change  | Places moved since the previous answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Room boards                  |
| Duels        | Live with whoever comes (a recording of a real game if nobody does in 10 s), a friend in their own time: won of played; between two friends, their record („3 : 2“)                                                                                                                                                                                                                                                                                                                                                                                                     | Дуел, Профил                 |
| Rating       | Elo from 1000, moved by duels and Роял; shown as a division (Бронз → Легенда) with its generated emblem                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Дуел, Роял, Профил, Класации |
| Роял         | Live at 21:00 Friday to Sunday, every evening once those fill (lobby from 20:45): up to 50 on the same question at once, 15 in three rounds; cut after 5, 8, 11, 14 by right answers (then speed), the last a final of three; those cut play on, off the standings                                                                                                                                                                                                                                                                                                      | Роял, Класации               |
| Goals        | Three a day, kept all day: the day's questions (50 XP), one drawn (100) and a harder one (150), of two families not drawn the day before, each one that can be done that day (Роял only while the evening's is ahead, and as on Начало for a new player); each a link to where it's done, told at the game's end                                                                                                                                                                                                                                                        | Начало, result               |
| League       | A race every week (Monday to Sunday) on the day's points, added up day by day, in a group of up to 20 of the player's league: Странджа, Средна гора, Родопи, Стара планина, Пирин, Рила. At the week's end the first go up (5 of a full group), the last go down, and the first three earn 300, 200 and 100 XP; first place in Рила is a title that counts („Двукратен шампион на Рила“)                                                                                                                                                                                | Класации, Профил             |
| Boards       | The day's ten, the week's league group, rating (10 rated games or more) and knowledge (mastery, the share of the questions known, after 100 answers, or 30 in a topic), of everyone or of friends                                                                                                                                                                                                                                                                                                                                                                       | Класации                     |
| Friends      | The day's board among you and your friends, once a friend has played                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Класации                     |
| Level        | All the XP a player has earned; each level takes 150 more than the last (300 for the first); lilac (its bars, the disc on an avatar)                                                                                                                                                                                                                                                                                                                                                                                                                                    | Начало, Профил, avatars      |
| Achievements | 33 facts of a player's games in four tiers (обикновени, редки, епични, легендарни), each saying how it's earned; announced once                                                                                                                                                                                                                                                                                                                                                                                                                                         | Result, Профил               |
| Titles       | Words for the player and their knowledge, worn under their name, never only a deed, one tap's luck or the hour: a ladder by level („Нова искра“ at 1 … „Жив алманах“ at 50, worn until the player chooses another, the newest reached), some achievements of how someone plays („Светкавица“: five right in a game, each under 3 s), a topic's mastery („Майстор · История“, „Светило · История“), and the rating and the league (divisions, a Роял won, Рила's champion counted). In their tier's colour; yours first, the locked ones by group with what unlocks them | Boards, friends, rooms       |
| Avatars      | A picture on a tone: nine animals free, emblems unlocked by achievements (the crown at level 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Everywhere a player is       |

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
- **The day's issue** is said one way everywhere (`issueWords()` in `lib/words.ts`): „Брой 6 · 17 ноември“, the
  result's line and Моят Алманах's days; the shared result's first line is „АЛМАНАХ · Брой 6 · 17 ноември“.
- **No emoji in the interface.** The one place they appear is the text a player shares of the day's result
  (`game/share.ts`: 🟩 right, 🟨 close, ⬜ wrong or not answered: grey, as in Wordle, so that a bad day is
  shared too), which never shows on a screen.

## Motion

- **Timings:**
  - presses 120ms; hover and colour 160–200ms;
  - the right answer's pop 360ms (to 1.04); the wrong answer's shake 320ms (4px);
  - an answer's points rise 520ms; a result's 800ms;
  - the timer runs linearly with the clock, and so does the ring of the three-second count before a topic's run
    (with „Започни сега“ and „Откажи“, so a tap on a topic never throws the player straight into a question).
- **An answer shows in beats** (a run's: the day, a topic, a friend's duel; `beats` in `game/questions.ts`), the
  same however quick the line, all within a second: the clock stops at the tap, and what was chosen stays chosen (its
  accent ring) at least 280ms; then the player's own answer is judged (pop or shake), with its sound and touch and its
  pip filling (0.6→1, 200ms); at 300ms the right answer pops if it wasn't theirs, the rest dim, and the verdict docks
  (24px up, 240ms) with its points and the tally rising in step; at 550ms the shares of everyone's answers grow behind
  them, their numbers fading in, and the sentence about them; at 700ms the fact and „Напред“. The page doesn't scroll
  to them on a phone (the panel comes to the player); on a big screen it does, at 560ms. A run's head (the count, the
  topic, the tally, the clock) and its pips stay at the top of the screen while the question and its answer scroll,
  smaller once stuck (the clock a thin bar along its edge, the seconds at the pips' end), so the pip and the tally
  are seen landing. A game played with others (a live duel, a room, Роял) shows its answer at once, when the server
  says.
- **A result lands, once** (`web/src/feel.ts`, at most 1.6s, a tap anywhere jumps to the end, never again on a
  reload): the pips fill one by one (60ms apart, 85 on the day; each with a pluck a step up the scale for each right
  answer before it, so a good game climbs, and a muted thud for a wrong one); as the last fills (at 700ms, about 0.9s
  on the day) the score lands (1.15→1) with the motif and the points count up; on the day, at 1.1s the streak's
  number rolls from the day before with the flame, unlit till then, lighting and swelling once and its sound, and the
  level's bar fills in its chip (a new level:
  to the end, a lilac flash, the number rolls, it fills again). Ten of ten: the pips sweep gold, „Всички верни“ and the
  rosette as a seal, drawn petal by petal, the gold one last. All typographic: no particles.
- **A duel's result lands, once** (feel.ts `duel`, at most 1.6s, a tap jumps to the end, never again on that
  device): the verdict waits while the marks fill pair by pair (75ms apart, a pluck for each of the player's right
  ones, a thud for each not), the two scores counting up with them so the lead changes hands as it did, the band of
  the deciding question lighting as it's reached; at about 0.9s the verdict rises and the scores land, the winner's
  turning gold, with `win`, `lose` or `end`; then what it meant fades in, the rating's bar filling from where it was.
- **The big news is a sheet**, at most one a game, only for what really is big: a week of the league ended up or on
  its podium, a division reached, the streak at 3, 7, 30, 100 or 365 days, a level that unlocks something or is a
  fifth, an epic or legendary achievement. It opens once the result has landed, slides up (320ms) over the dimmed
  result, its picture landing; its sound plays as it opens; „Продължи“, a tap beside it or Esc puts it away, never by
  itself. The news cards under the result stay as they are: the sheet is the headline brought forward, not a fourth
  card. A new level's sheet has its number as the hero (120px, in the levels' lilac) over „Ново ниво“, then what it
  brings as a gift („Получаваш рамка „Пръстен“.“) over the player's avatar wearing it; with something to wear, „Сложи“
  is its gold button and „По-късно“ a link in place of „Продължи“.
- **No ambient motion** and no confetti.
- **Reduced motion** („По-малко движение“, which follows `prefers-reduced-motion` until set): the pop, the shake, the
  rise, the transitions and the steps stop; a result and a sheet show their end state at once, with their sound. The
  timer and the count before a run still move, because they are information.

## Sound

- **Made in the browser, in code** (`web/src/feel.ts`, loaded with the first touch; the switch and the turns in
  `web/src/lib/sound.ts`): there are no files to load, and nothing to license.
- **One key:** every note is in D major pentatonic (D E F♯ A B), so sounds that follow each other sound like one
  piece. A right answer rises a step of the scale with each right one before it in a row, up to an octave.
- **The motif** D–A–F♯–D, as bells (four petals, the last one gold), is the game's audio logo: `end` plays it plainly;
  `perfect` (ten of ten) and `level` with a harmony and a little room; `win` over a low D.
- **Four voices:** a bell (FM) for what's earned; a wooden pluck for the player's own touches; a soft thud for a wrong
  answer or none (never a buzzer); a short beep for the clock. Everything goes through a compressor, so sounds that
  meet can't clip.
- **Short:** an answer's sounds are over in under half a second; a moment's (the end, a level, Роял's cut) may take up
  to 1.4 seconds, as it comes once a game.
- **One sound per moment**, and only for game moments:
  - `tap` when an answer is given;
  - `key` for each key of the number pad and each move in an order;
  - `right`, `exact`, `partial`, `wrong` or `time` with the verdict;
  - the clock, only near the end: silent until 10 seconds are left, then a soft `tick` a second, and `hurry` once a
    second for the last five, a step higher each (a question of 10 seconds sounds only those five). „Тиктакане“
    turns it off;
  - `count` for each second of the count before a run, `go` at its start;
  - `end` when a run's result opens (`perfect` for ten of ten), `win` or `lose` at a duel's or Роял's end;
  - `through` or `out` with Роял's cut;
  - `level`, `achievement` or `goal` with the news: only the biggest thing told plays;
  - `ping` when a game or a duel starts, or a friend calls to a duel.
- **Nothing plays** for navigation, hovering or decoration.
- **Music only in Роял's lobby**, for those in, waiting for 21:00 (none in the day or a topic: people play those on the
  bus or among others): a quiet bed in the key, four bars at 64 a minute (a pad of detuned saws under a slow filter, a
  soft bell every two bars), 24 dB under the sounds. In the last ten seconds it opens up and rises into the start; the
  first question ends it with the motif's first two notes, in place of `go`. It follows „Звуци“ and has its own switch,
  „Музика в Роял“ (on by default, kept on the device).
- **On by default**, with one switch in Профил („Звуци“) that's kept on the device. The audio starts on the
  player's first touch, as browsers require; a sound that isn't allowed yet is skipped, never queued.
- **Touch, in the app** (`web/src/lib/phone.ts`, sound or not; „Вибрация“ in Настройки → Звук, only in the app, on by
  default, kept on the device): a light knock when an answer is tapped; a selection tick for each digit, move and
  card placed; a medium knock for a right answer and for the streak growing; success for an exact one and for ten of
  ten; a light knock for a close one; two light knocks, 80ms apart, for a wrong one or none (never the phone's error
  alert); success, then a heavy knock 120ms later, for the big news's sheet, for getting through Роял's cut and for a
  win (a duel, Роял, first in a room); a light knock for going out of the cut and for a duel lost.

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
  (crossed swords, a crown in laurel, an open door) on its card and over its page, and over Приятели (two friends
  side by side, the fox and the bear, heads leaning together: the avatars are the players' faces) and Моят Алманах (a
  book); the streak's flame; the frames, the divisions' crests, the leagues' mountains and the achievements' medals.
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

- **Look at it** in both themes, at 320px and 390px wide, and at 1024px and 1440px. Nothing may scroll sideways, and keyboard focus must show.
- **Run the checks:** `npm run check`, then the browser tests (`npm run e2e`), which include the accessibility
  checks.
- **Keep it light:** `go run ./cmd/build` says how big each file is, gzipped. What a change adds should be worth its
  size, but there's no budget to write around: the build fails only past a ceiling far above the game, which only a
  mistake reaches.
