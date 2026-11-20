# Design

АЛМАНАХ is set as an edition (DECISIONS.md, „The redesign“): a publication a player keeps, not a generic game app.
Every day is an issue („Брой 9 · 20 ноември“); what a player has learned is a book, with chapters, entries and notes.
This file holds the rules. The values live in `web/src/app.css` (the tokens at its top; a duel's result in
`outcome.css`, the admin pages in `admin.css`), and the pieces several screens share live in `web/src/ui.ts`. Follow
all three when you add or change a screen.

## Principles

- **A publication, not an app.** The structure is typographic: a masthead, ruled sections, a dateline, columns, a
  table of contents with leaders, a ledger. No cards, no shadows, no gradients, no glows.
- **Paper first, a night of its own.** Day is warm paper with ink. Night is not the day inverted: a deep blue-black
  page under a lamp, so the one action turns lamp-gold and the numerals paper-white.
- **Colour only where it means something:** right (green), wrong (red), the one action, a chapter's own colour as a
  small accent (its kicker, its picture, its track), and the gold petal of the mark (today in the streak's week, the
  question being asked, the caret). Everything else is ink on paper in three strengths.
- **Numerals are the heroes.** The date, the score, the streak, the share of a chapter known: set huge in the numeral
  face, tabular. The words around them are small and plain.
- **One obvious action per screen:** `.btn.primary`, a full-width bar of ink by day and lamp-gold by night („Започни“,
  „Напред“, „Сподели резултата“, „Играй главата“, „Реванш“). Everything else is a text link (`.link`) or an outlined
  button (`.btn`).
- **Only what the game counts.** Every number, mark and moment measures something the game really keeps (Game feel,
  below). What adds up across games is the Алманах (the facts a player has collected, how well they know each topic)
  and the streak. There is nothing to buy, earn or unlock, and a bad game is never celebrated.
- **Few taps.** Every game starts one tap from where it's offered. Only a tap starts one: a game reached any other way
  (a reload, back or forward, a link from outside) waits on a still screen (`startScreen()`, `.start-screen`: what it
  is, or where it was left with its pips, and „Започни“ or „Продължи“).
- **Leaving asks.** While leaving costs something (a question with its time running), every way out (the game's
  cross, the browser's or a phone's back) asks first and says what it costs (`guardLeaving()`). A way back (`back()`,
  the cross) goes back in the history when that's the page it points to, and never piles up an entry; back comes to a
  page scrolled where it was.
- **Phone first.** Every screen fits a 320px phone without scrolling sideways, at the usual text size and at twice
  it (Large text), with a 20px gutter.
- **A big screen is a spread, not a stretched phone:** from 56.25rem (900px) the gutter is 48px and the page is up
  to 1270px wide, with two „pages“ side by side divided by a vertical hairline (`.spread`, a 12-column grid with 40px
  gaps; `.page-1` and `.page-2`, and `.page-mid` for a third). Its rules live in `min-width` blocks and never change
  how a phone looks.

## Places

There are three places: **Днес** (`/`), **Алманах** (`/almanac`) and **Приятели** (`/friends`). Профил and
Настройки open from the player's avatar in the bar's corner (`/me`, `/settings`). Nothing else gets a place.

- **The frame** (`app.ts`, `.frame`): the bar (`.bar`) holds the rosette (`rosette()`: three ink petals and one gold)
  and „АЛМАНАХ“ in Literata spaced capitals, which is a way to Днес. On a big screen the bar also has:
  - the three places as words (`.places`, the current one bold with a 3px ink underline);
  - the issue on the right („Брой 9 · 20 ноември“, `.bar-issue`; not on Днес, whose dateline says it);
  - the avatar (`.bar-me`, 32px, round), or „Вход“ (`.bar-in`) without a profile or on a new visitor's cover.

  The double rule runs under the bar (2px and 1px, 2px apart). On a phone the three places are words at the foot
  (`.places-foot`, no icons): the current one is bold with a 3px ink tab on its top rule, and Приятели gets a dot
  while a request or a friend's duel waits. The frame steps aside while a question is asked on any screen
  (`html.playing`: the game's cross is the way out) and on a new visitor's cover (`html.cover`).
- **Днес** (`/`, `screens/today.ts`), the day's issue:
  - Under the frame, the dateline (`.dateline`: „Брой 9“ and „Петък, 20 ноември“).
  - The date as the hero numeral, with the month in the serif's italic (`.issue-date`).
  - „Десет въпроса за днес.“ and its deck, then „Започни“ (`.issue-go`). A day left half-way says „Следва въпрос 4
    от 10.“ and shows its shape so far, with „Продължи“.
  - One line of meta: „Около три минути · Днес играха 4812 души“.
  - On a big screen, the issue's contents (`.contents-issue`, „В броя“): its ten topics in order, each with its
    chapter's dot.

  The issue is the day's number counted from the first day of the day's ten (`play/issue.go`: 12 November 2026 is
  Брой 1), the same for everyone.
  - **A new visitor** (no game begun) gets the cover alone (`html.cover`): the bar becomes the masthead, with the mark
    over the name in the middle and „Вход“ in its corner. There are no places, and nobody's name shows. On a big
    screen the date is on the left page and the issue on the right.
  - **A player** has three things beside the issue (under it on a phone, `.today-side`):
    - The streak (`.today-streak`): its number and „дни поред“, and this week as squares (played filled, today
      ringed in gold, a day forgiven hatched: `weekStrip()`). It also says what today makes of the streak
      (`.day-stake`: „Серия от 5 дни. С днешните въпроси става 6.“; from 18:00, if the week has forgiven its day
      already, that it ends).
    - The friends' day (`.today-friends`: their scores, and „Всички“ to Приятели).
    - The way to the book (`.book-link`).

    Topics are played from their chapter in the Алманах and duels from Приятели; nothing else is on Днес.
  - **Notices:** quietly over the day (`.notices`, `.streak-notice`), told once on the server, not once per device:
    a day the week forgave, a streak that ended, a welcome back, a friend's duel waiting, a friend's yes, a shared
    day that's over.
  - **A shared day's link** (`/d/<issue>-<code>`) leads with the shared score and its shape (`.shared-score`), titled
    „Колко ще познаеш ти?“. The page names nobody: the day's board names its players only to someone who has played
    the day (`server/game.go`).
- **The day's result** is Днес once the day is played, as it lands and on every later visit. It is a spread
  (`.result`): the score on the left page (`.result-main`) and България on the right (`.result-side`).
  - The kicker „Твоят брой 9 · 20 ноември“.
  - The score as the hero numeral with „от 10“ in italic (`.score-n`, `.score-of`), and its shape (`.trail`: right
    filled, wrong open).
  - A line of how it went („Седем верни. По-добре от 61 % от играчите днес.“, `game/standing.ts`), and the points,
    small.
  - The streak rolling on (`.result-streak`).
  - „Сподели резултата“ (`.result-share`, the one action) opens the share sheet (`.share-sheet`): the card a link's
    preview shows, the text, and „Сподели“ (where the device has a share sheet) or „Копирай текста“
    (`game/share.ts`).
  - „Прегледай въпросите“ opens the questions under the page.
  - „България днес“ (`.bulgaria-today`, from ten players): how many got each count of right answers, with the
    player's bar in ink marked „ти“ and the average dashed; then the average, the tens, and the share that knew the
    hardest question.
  - An entry the day's right answers wrote, as the book has it (`.rarest`): from ten players „Най-рядкото ти
    попадение“, its chapter and how few knew it; with fewer, „Днес в Алманаха ти“, the hardest, its chapter and
    „въпрос 8“, nothing of others. Then the answer as a headword, the question, the fact, and „Записано в Алманаха,
    глава „…““. It is a right answer, so it is in the book; a game with none shows nothing here.
  - Tomorrow (`.tomorrow`): the next issue's date set large, when it comes and the streak it makes; then a guest's ask
    to keep the game, or the reminder's ask.
- **Алманах** (`/almanac`, `screens/almanac.ts`), the player's book, a spread on a big screen:
  - „Твоята книга“, „Алманахът на <име>“ and when it began (the first game's day).
  - Three figures between rules (`.figures-row`, `.fig`): дни поред, факта, от всичко знаеш (Микс's share).
  - The contents (`.toc`): a chapter a row (`.toc-row.t-<topic>`) with its picture, its name in the serif on dotted
    leaders (`.toc-dots`, gone under `tight`) to the share known, and under it its facts, its tier (or „първа
    оценка“, „още без оценка“) and a 3px track in its colour (`.toc-track`). The ten topics come first, then „Микс“
    (every topic) and „България“ (with its tricolour, `.flag`).
  - The notes the book keeps (`.almanac-notes`, a ledger): the day in small capitals and the note in the serif, with
    the streak's next milestone ahead in italic („Тридесет дни поред, ако не спреш.“).
  - A visitor without a game sees the book as it starts: the contents, each chapter a way to play it.
- **A chapter** (`/almanac/<topic>`):
  - „← Алманах“, „Глава 3“ in its colour, its name and its picture.
  - How much of it the player knows (`.know`): the share big, its tier in a sentence, and „на крачка от „Експерт““
    when within 5%.
  - Its scale (`.scale`): a 4px track filled in its colour, a tick at each tier, a mark at the player, and only Новак
    and Светило named.
  - „Играй главата“, the topic's game; a game left half-way is „Продължи главата“.
  - Its facts as entries (`.entries`, two columns with a rule on a big screen). Each entry has:
    - a dateline (`.entry-when`: „20 ноем. · Брой 9“, „Игра на главата“, „Дуел“);
    - the answer as a headword (`.entry-word`; a statement is its own headword, with „Невярно:“ before one that isn't
      so);
    - the question in italic (`.entry-q`);
    - the fact (`.entry-fact`), with a drop cap in the chapter's colour on the page's first entry.
  - The latest come first, thirty to a page (`.pager`: „← По-нови“, the numbers, „По-стари →“), and are found by their
    words (`.search`, at most 60 letters). The page and the search are kept in the address (`?page=2&q=…`); each page
    is a link, an entry of the history of its own (back from page 3 is page 2), and a page past the last is the last.
  - A chapter's share known shows from a first estimate with a right answer in it: answers all wrong tell nothing
    („С първия верен отговор ще видиш колко от главата знаеш.“), on the chapter, its row and the book's figures.
- **Приятели** (`/friends`, `screens/friends.ts`), three pages on a big screen:
  - **The day's board** (`.day-board`: „Приятели“ or „България“, a `segmented` choice), where a row is the place, the
    avatar, the name, the score and the points (`rankRow()`, `.rank-row`; the player's own on `--paper-2`, with
    „ти“).
  - **The duels** (`.duels`): „Твой ред“ (a friend's duel waiting for the player, or their own to finish), „Чакаш“
    (sent and not played yet) and „Изиграни“ (the score and the pair's record, „общо 5 на 3“). Each is a ruled
    `.duel-row` to its page, saying how long is left („още 2 дни“). „Нов дуел“ comes under them.
  - **The friends** (`.friends`): requests (`.invitation`, accepted or not: nobody becomes a friend alone), then a row
    per friend (`.friend`: the name, today's score, the duels between you, and „Дуел“; „Промени“ shows „Премахни“
    instead), and the one way to add a friend: the field for потребителско име or имейл, „Добави“, and the requests
    still waiting (`.waiting-for`).

  A player still using the name drawn for them is asked for theirs once on a device, the first time others would see
  it: a sheet from the bottom (`screens/name.ts`) with the drawn name in its one field, and „Не сега“ quiet. A name
  field never asks the browser for a full name (`autocomplete` nickname or off: `fields.test.ts`).
- **Профил** (`/me`) is a spread:
  - Left page (`.me-intro`): the avatar as it's worn, the name as the page's title in the serif, the tag, and
    „Промени името“ (or, for a name still drawn, that it was and „Смени го“). Then three figures between rules
    (`.me-figures`: days in a row, the longest streak, the issues played), what the week forgives under them, and
    „Всички игри“ (`/games`) and „Как те виждат другите“. A guest is asked here to keep the game.
  - Right page (`.me-side`): „Аватар“ with all fifteen animals, each with its name (`.picker`, `.pick`,
    `.pick-name`). Every one is anyone's from the first day; the one worn is ringed in ink, and a tap wears it (the
    bar's avatar with it: `state.look`). Then „Настройки“, a row to their page (`.me-settings`).

  `/avatar` is the same choice on a page of its own.
- **Настройки** (`/settings`): the name, the email for signing in, „Изглед“ (Автоматично, Ден, Нощ), „Размер на
  текста“, the sounds and the clock's tick, „По-малко движение“, reminders by mail and notifications, and the
  profile's end. A setting that is on or off is a `switchRow` (the whole row is a label to tap); a choice of a few is
  a `segmented` radio group. There are never native selects, radios or checkboxes.

## First days

A new player meets the game a part at a time, by what they've done, never by the date:

- **A new visitor** gets the cover, the day alone. The places come with the first game begun.
- **The first day** brings the day's result and its points (what points are is said once, in a quiet line at the top
  of the first game's news, `.news-open`) and the streak; the Алманах's chapters and Приятели are a tap away.
- **A chapter's first estimate** (10 answers): the chapter says „първа оценка“ with its share, and a game's news says
  „Първа оценка: знаеш около 74 % от темата“, a share with no tier. The tier („Експерт“) comes with a sure mark (30
  answers).

**Points** say what they are where they first show, and a tap from anywhere they do (`explain()`: the word dotted
under, its meaning in a small card under it; the words are `meaning` in `ui.ts`). They are one game's score (right
answers and speed), and the day's board is ordered by them after the right answers. There is no rating: a duel's
standing is its record between two people.

## Space and size

- **Space** on a 4px base: 4 · 8 · 12 · 16 · 24 · 32 · 48 (`--space-1` … `--space-7`). A section is 48px from the
  last (`.sect`: a heading on an ink rule, `.sect-head`, an optional small note right-aligned on its line,
  `.sect-note`); inside it, 8–16.
- **Rows** are 56px or more, with a hairline between them.
- **Touch targets** are at least 44px high; the bar's are its full height. A link on its own line is `.link.tap`.
  Anything drawn smaller gets its room around it (a pill's padding through `::after`, a row's or the header's height
  through padding and a negative margin), so the layout doesn't change for it. A link inside a sentence is read where
  it is, at the line's height. `e2e/text.spec.ts` tries each control with a finger's reach.

## Large text

The text grows with the browser's own setting and with „Размер на текста“ in Настройки („Обичаен“, „Едър“ 125%,
„Много едър“ 150%: `lib/prefs.ts`). The two multiply, up to twice the usual. Everything is sized in rem from
`<html>`, so a screen at twice the text on a 320px phone is a screen on a phone 160px wide, and it holds that way
(`e2e/text.spec.ts`):

- **A media query's rem is the browser's own size,** not the page's: the browser's setting grows it, „Размер на
  текста“ doesn't. So a short screen is a phone on its side only with `(orientation: landscape)` too: at 32px an
  upright phone's 640px is under `max-height: 30rem`, and it would get the side-by-side panel, squeezed to nothing.
- **Display type grows at half the rate** (titles, the date, the question, the big numbers): it is set as half px,
  half rem (`calc(17px + 1.0625rem)` for 34px), which is the same at the usual size. A numeral that could still
  outgrow a narrow column is capped by the screen's width as well (`min(…, 46vw)`).
- **Nothing is wider than its column:** one-column grids are `minmax(0, 1fr)`, not `1fr` or `auto` (a long word
  breaks with `overflow-wrap` rather than widening the page), and a row of things wraps (`.verdict`, a run's head, the
  issue's date and month).
- **Rows give way to columns** once the column holds few words. `lib/prefs.ts` measures the main column in em and puts
  `tight` on `<html>` under 17em and `tighter` under 13.5em; at the usual size even a 320px phone's column is 18em.
  - Under `tight`: a board's score goes under the name, the figures one under another, the notes' day over its note,
    a duel's state under the player, „Вярно“ over „Невярно“, switches of choices on two lines, and the answers as tall
    as their words (the four in sight).
  - Under `tighter`: the places show their words smaller; a pair's mark sits over its words; a choice keeps the room
    for its share and its ✓ or ✕ at its foot, not its end; and a run's answer comes under the answers rather than
    docked at the screen's foot (there it would leave no room for both the right answer and its fact).
- **A word breaks only where it's wider than its cell,** at its syllables where the game knows them (a pair, a thing
  to sort, a group: `wholeWords()` in `game/questions.ts`). It never breaks as „Каралий-|чев“ where „Каралийчев“ fits
  the next line, nor as „Шве|ция“. Every control is a scroll away and every answer can be read (`e2e/text.spec.ts`).
  This is not done with a container query: Chromium doesn't always re-evaluate a rem one as the root's size changes.

## Wide screens

- **48rem (a tablet):** the column grows to 48rem and the places move into the bar. A page's buttons are a hand's
  width (22rem), not the column's, at its left, the gold one first. A group of them (`.actions`) sits side by side
  where two fit, the plain ones after the gold one and as tall as it. A page's quiet lines sit at the left with them,
  as on a phone, never centred.
- **56.25rem (900px):** the places are spreads (above):
  - Днес: the issue on the left page with „В броя“ under it; the streak, the friends' day and the book on the right.
  - The day's result: the score on the left; България's day and the day's entry on the right.
  - The cover: the date on the left page, the issue on the right.
  - The Алманах: the book's title, figures and notes on the left, the contents on the right. A chapter: four columns
    for its head, eight for its entries.
  - Приятели: the board, the duels and the friends, three pages.
  - Профил: who you are on the narrower left page, the avatars and Настройки on the wider right.

  Every other page is a centred column of 48rem, so no line of text runs too long.
- **64rem (a laptop):** a question is a spread too. The topic, the question and its picture are on the left page,
  and what answers it on the right. The answer (verdict, how everyone answered, the fact, „Напред“) comes on the left
  page under the question, beside the marked answers; on a screen too short for both it keeps to the screen's foot
  over the question's end, „Напред“ always in sight. A choice of pictures is four across on a laptop's height.
- **A computer** (a fine pointer that hovers) is shown its keys, as `.key-hint` marks, only where a key works:
  - beside each answer's letter its key, 1–4 (the same on every keyboard layout; the letter stays А–Г on every
    screen);
  - „Вярно“ and „Невярно“, 1 and 2;
  - the count before a run, Enter („Започни сега“) and Esc („Откажи“);
  - an answer shown, Enter (on at once).

  Never on a question gone over or one shown only to be looked at (`ask(…, display)`), nor on an answer once it
  shows.

## Colour

Day (paper) is on `:root`. Night replaces it under `prefers-color-scheme: dark` unless Day is chosen, and wherever
Night is chosen („Изглед“ in Настройки: `data-scheme` on `<html>`, `lib/prefs.ts`). So each Night rule is written
twice: `:root:not([data-scheme="day"])` under the media query, and `:root[data-scheme="night"]` outside it
(`scheme.test.ts` holds them equal). Never call this choice „Тема“: in the game a „тема“ is what questions are about.
A rule never holds a literal colour; it takes a token.

| Token                                      | Day                               | Night                             | Use                                               |
| ------------------------------------------ | --------------------------------- | --------------------------------- | ------------------------------------------------- |
| `--paper`                                  | `#f6f1e7`                         | `#121620`                         | the page                                          |
| `--paper-2`                                | `#ede6d8`                         | `#1a1f2b`                         | the player's own row, a pressed option, a well    |
| `--paper-3`                                | `#e3dac8`                         | `#242a38`                         | a pressed key                                     |
| `--ink`                                    | `#1c1915`                         | `#eee7d8`                         | text, headings, numerals, filled squares          |
| `--ink-2`                                  | `#4a443b`                         | `#c4bcad`                         | decks, secondary text, a loser's score            |
| `--ink-3`                                  | `#675f53`                         | `#9c9586`                         | kickers, meta, labels                             |
| `--rule`                                   | `#d9cfbd`                         | `#2a3040`                         | hairlines between rows, tracks                    |
| `--rule-2`                                 | `#8f8169`                         | `#68728a`                         | control outlines (an option's ring, a switch off) |
| `--rule-ink`                               | `#1c1915`                         | `#c4bcad`                         | section rules, the double rule                    |
| `--action` / `--on-action`                 | `#1c1915` / `#f6f1e7`             | `#e8b84b` / `#17130a`             | the one action                                    |
| `--right` / `--right-ink` / `--right-wash` | `#2f8a57` / `#1e6a43` / `#e2eedf` | `#5fc08e` / `#7fd3a6` / `#173127` | a right answer: its mark, its words, its row      |
| `--wrong` / `--wrong-ink` / `--wrong-wash` | `#c2493a` / `#a8372a` / `#f6e2db` | `#e9796a` / `#f2907f` / `#38201f` | the same for a wrong one                          |
| `--gold` / `--gold-ink`                    | `#d9a21b` / `#855b00`             | `#e8b84b`                         | the mark's petal, today's square, the caret       |
| `--scrim`                                  | `#1c191573`                       | `#000000a0`                       | under a sheet                                     |

- **Chapters** each keep one colour everywhere, the cloth of the chapter's binding (`--t-<topic>`, set as `--t` by
  `.t-<topic>`; text-safe on paper and paper-2 in both themes): general `#87600f`/`#d9ae55`, science
  `#1f6e76`/`#6cc0c8`, history `#8c3a2e`/`#e08c7d`, geography `#4f682a`/`#a9c277`, movies `#7a4580`/`#c99ace`, music
  `#3b55a0`/`#94a9ec`, sports `#9a481b`/`#ee9a68`, technology `#43648a`/`#91b2d8`, literature `#9c3f60`/`#e596b2`,
  nature `#376e41`/`#8ccb95`, Микс `#57514a`/`#bdb6ac`, България `#2e6b4c`/`#7cc59e`. A chapter's drawn picture takes
  its colour as `--tone`, so a picture always sits in its chapter.
- **Right and wrong never rest on hue alone:** they also show as a ✓ or ✗ in a disc, a filled or an open square, and
  the words.
- **Contrast:** text holds at least 4.5:1 on `--paper` and `--paper-2` in both themes, and control lines 3:1.
  `e2e/a11y.spec.ts` checks text with axe.

## Type

- **Faces**, our own files in `web/src/fonts` (SIL OFL 1.1; never a font from another host: the CSP allows
  `font-src 'self'` only), each cut into a file for Bulgarian and one for the rest (`subset.sh`, `fonts.test.ts`):
  - Literata roman 400–700 (`--font-serif`): headlines, the question, the name in the bar, verdicts, facts and
    entries.
  - Literata italic 500: decks, the month beside a date, a question under its answer, notes.
  - Sofia Sans 400–900 (`--font-sans`): interface text, buttons, kickers and labels. With `lang="bg"` it draws the
    Bulgarian letter forms (д, л, т); keep them.
  - Sofia Sans Extra Condensed 600–900 (`--font-numeral`): every numeral that matters, with tabular figures. It is
    for digits only: a word beside a big number (7 „от“ 10) is in the words' face, small, on its baseline
    (`.num-word`).
- **Scale** (phone / big screen; display type grows at half the rate the text does, see Large text):

  | Role                                         | Size                       | Face and weight                      |
  | -------------------------------------------- | -------------------------- | ------------------------------------ |
  | The hero numeral (the date, the score)       | 132–200 / 260–400px        | numeral 800, line 0.8                |
  | A big figure (the streak, a chapter's share) | 64–84px                    | numeral 800                          |
  | `h1`                                         | 34 / 54px                  | Literata 600, −0.012em               |
  | The question                                 | 25 / 40px                  | Literata 600                         |
  | `h2`                                         | 25 / 32px                  | Literata 600                         |
  | A section's heading                          | 20px                       | Literata 600                         |
  | A deck (`.deck`, `.lead`)                    | 18 / 21px                  | Literata italic 500, `--ink-2`       |
  | Body serif (facts, notes)                    | 16.5–19px, line 1.5        | Literata 400                         |
  | UI                                           | 16px (an option 18 / 20px) | Sofia Sans                           |
  | Small and meta (`.small`)                    | 13–14px                    | Sofia Sans, `--ink-3`                |
  | A kicker (`.kicker`)                         | 12px                       | Sofia Sans 700, capitals with 0.14em |
  | The name in the bar                          | 15 / 17px                  | Literata 600, capitals with 0.2em    |
- **Case:** sentence case everywhere. Capitals come only through `.kicker` and the wordmark.

## Shape

- **Rules:**
  - a hairline (1px `--rule`) between rows;
  - an ink rule (1–1.5px `--rule-ink` or `--ink`) under a section's heading, over the choices and over a fact;
  - the double rule (2px and 1px, 2px apart) under the bar and the masthead;
  - a 1.5–2px ink underline for a field or the typed number.
- **Corners:** 3px on buttons and controls (`--radius`), 2px on squares, round for avatars and marks. Nothing else is
  rounded.
- **No depth:** no shadows, no glows. What is raised is said by a rule or a wash. Sheets are the one exception: a
  sheet lies over a scrim.
- **Focus:** one rule for everything (`:focus-visible`): a 2px ink outline, 2px off the edge. A field shows its focus
  by its underline turning gold.

## The pieces

- **Layout:** `.screen`, `.stack`, `.spread` with `.page-1`, `.page-2` and `.page-mid`, `.sect` with `.sect-head`
  and `.sect-note`, and `.figures-row` with `.fig` (`.fig-n`, `.fig-label`).
- **Getting around:** `.places` and `.places-foot`, `.back` (drawn by `back()`) and `.me-settings`.
- **Text:** `.kicker`, `.deck`, `.lead`, `.muted`, `.small`, `.bad` (errors) and `.status`; `.explain` with
  `.explain-pop` (a number's name, a tap from its meaning: `explain()`). A page leads with the thing, not its rules,
  and a lead is one sentence.
- **What went wrong** is never a dead end. `failure()` (`.failure`) says what happened and offers „Опитай пак“ (the
  one action) only where trying again can help (no connection, or the server for a moment). It tries again by itself
  as the connection comes back, and always has a way on („Към Днес“, or the screen's own place). In a run it keeps the
  run's head and its clock, and a step that doesn't get through is first tried again quietly.
- **Controls:**
  - `.btn`, with `primary`, `big` and `danger`; and `.link` (`tap` for one on its own line, a finger's height).
  - Like things are one size: a field is a button's height (48), and every number of a size comes from the scale.
  - `.field` and `input.code`; `.join` for an input with its button. A field is an underline with an italic
    placeholder.
  - `.segmented` (`segmented()` in `ui.ts`): tabs that switch what a screen shows (words with a 2px ink underline on
    the chosen one), or, as radios, a setting's few choices (boxed, the chosen one filled with ink).
  - A switch: a 46 × 28 track, ink when on with a paper knob, outlined in `--rule-2` when off.
  - `.sheet`: paper with an ink rule on top, over the scrim; a bottom sheet on a phone, centred on a big screen.
- **The streak:** `.streak-chip` (its number, „дни поред“ and, unlit, the day before it rolls on) and `weekStrip()`
  (`.week`, the week Пн–Нд as squares).
- **Rows of players:** `rankRow()` (`.rank-row`: the place, the avatar, the name, the score, the points), `who()`
  (`.who`: an avatar and a name), `.friend`, `.invitation` and `.duel-row`.
- **Play:**
  - `.question-head` holds:
    - `.game-leave`, a cross that is the way out on every screen;
    - what's played: the day's „Брой N · date“, or the topic, with `.versus` naming the friend in a duel;
    - the tally (`.tally`: the right answers in a row it's on, and its points so far);
    - `.count`: „4/10“ to the eye, „4 от 10“ read aloud; it never wraps.

    In the day's ten, `.question-topic` (the topic's mark and name) sits over each question.
  - `.question-top` holds the head, the pips (`.trail`, in a run a row of bars the column's width: done in ink, wrong
    open, the question asked in gold) and the clock (`.timer`, a hairline under the bars with the seconds small at
    its end). The clock is muted while there's time, `.soon` gold for the last ten seconds of a question longer than
    ten, `.low` red for the last five, and `.stopped` once answered.
  - `.ask`, the question in the serif.
  - `.picture` over a question: its box is the picture's own (no wider than the column), with a hairline inside its
    edge so a white flag holds on paper. While it's asked, `picture(view, true)` keeps it low enough for the
    question, the picture and the whole answering part to fit on the screen (no less than 128px). A question's time
    starts once its pictures are in.
  - `.options .option`, with the states `picked`, `placed`, `right`, `wrong` and `dim`:
    - A choice's answers (`.choices`) are ruled rows under an ink rule, each letter in a ring. Once answered, the right
      row is washed in `--right-wash` and the chosen wrong one in `--wrong-wash`, their rings filled. They keep room at
      their end from the start for what the answer brings there (the share that gave each, and its ✓ or ✕), so
      nothing re-wraps as it comes.
    - `missed` is a row of a right answer the player didn't have (an order, pairs, groups): plain, with a hollow ✕ and
      „ти: …“ for what they gave.
  - „Раздели“: `.split` with `.split-deck` (the thing now showing on a `.split-card`, the next one `under` it; dragged,
    it names the group it's going to), `.split-sides` (the two groups as `.option.split-side`), `.split-pips` and
    `.split-back`; afterwards `.split-result`.
  - A choice of pictures: `.options.pic-options` (two by two), each `.option.pic-option` a picture with its letter
    (`.pic-letter`) and, once answered, its name (`.pic-name`) and the share that gave it on its corner. The
    pictures' credits are in `.pic-credits`.
  - „Подсказки“: `.clues`, with a `.clue` per clue showing what a right answer is worth then (`.clue-worth`). The
    last one out is `now` (a gold edge), the ones before it `past`, and the ones to come `locked` (counting down).
  - The number: `.number-out` shows the numeral big on an ink rule, with a gold caret and the unit in the serif's
    italic. `.keypad` is a ruled grid of keys.
  - How everyone else answered, once a question has enough answers:
    - `.option.crowd`: a bar behind an answer as long as the share of players who gave it, with the share beside it;
    - `.spread`: where a number's guesses fell, the answer's part in `--right` and the player's in ink;
    - `.crowd-says`: one quiet sentence under the verdict, or under the answer in a review (`crowdLine()`: the share
      right, of today's players for the day's ten). `.rare`, in `--gold-ink`, marks a right answer a quarter or
      fewer got.
  - `.verdict`: its word in the serif, in `--right-ink` or `--wrong-ink`, with its points.
  - `.fact` (`fact()`): „Знаеше ли?“ as part of the page under an ink rule. For a question of the day's ten dealt on
    its own date, `.fact-day` heads it with „На този ден“ and what happened that day. It shows only with the answer,
    never before it. With a right answer, `.filed` goes under the fact: „Записано в Алманаха, глава „…““, with its
    chapter's mark before it. A wrong answer's fact goes into the book with the first right answer, and nothing says
    so then.
  - `.leave-layer` with `.leave-ask`: asked to leave, a sheet of opaque paper across the foot, over the answers, with
    „Остани“ as the one action and the clock running in sight above it.
- **A topic's result** (`game/results.ts`, `.summary`), the same shape as every result: the score and its shape;
  right under it what to do next (`nextSteps`: one `big` primary button, „Още десет“ — or, while the day's ten wait,
  the way to them, with „Още десет“ plain); then the game's news; and at the end the questions, once opened. Each
  question gone over is its own block (`.reviewed`, a band in its verdict's colour on top): its number and topic as a
  kicker with „Вярно“, „Близо“ or „Грешно“ beside them, the question as the strongest line, the answers marked, and
  the fact as a quiet note under them.
- **A duel played** (`screens/duel.ts`) plays as any game (`game/run.ts`), with „Дуел с Мария“ over each question
  (`.question-head .versus`):
  - Played second, or against a recording, the other's answer shows as they gave it. The line over the question turns
    „Мария отговори“ at the moment they did (with the sound `them`). Once the player's own answer is in, how it went
    for them shows under the verdict (`.their-line`: „Мария: вярно за 4,2 с“, in the right answer's green; „грешно“,
    „близо“ and „без отговор“ muted). Their points wait for the end.
  - Played first, the result is the player's own (`.summary`), with a line that it's sent (`.duel-sent`: „Изпратен.
    Мария ще изиграе същите десет въпроса: има време още 3 дни.“).
  - „Нов дуел“ (`/duel/new`): each friend is a row („Дуел“, as on a friend's row in Приятели), and there is „Играй
    срещу запис“ while there is a recording to play (`GET /api/duels/recording`).
- **A duel's result** (`screens/outcome.ts` with `outcome.css`, loaded as a duel starts) is a page (`.duel-end`):
  - The kicker („Дуел с Мария“, „Срещу запис на Мария“: a duel is named so everywhere) and the verdict in the serif over an ink rule (`.duel-verdict`:
    „Победа“ in green, „Загуба“ in red, „Равенство“).
  - The two face to face (`.duel-face`): the player on the left, the other on the right, each with a small avatar and
    the name (a way to the profile, „Запис“ for a recording) over the points, big in the numerals, and the right
    answers. The loser's points are quieter, and a gold colon sits between them. A player gone since shows a dash
    and „Играчът вече го няма“.
  - The duel question by question (`.duel-marks`, like the day's trail: right in ink, wrong an open square): the
    player's row over the other's, each beside a small avatar. The quicker of two right answers is ringed in gold
    (`.fast`, explained once under them), and a gold band sits behind the question that decided it.
  - One line of what decided it (`.duel-line`: „Водеше от 8-ия въпрос до края.“, „Реши го последният въпрос.“,
    „Равни точки: реши времето (…)“).
  - What it meant, under a hairline (`.duel-meant`): the record against this person („Срещу Мария 3 : 2“), or, against
    a recording, whose game it was („Записът е от истинска игра на Мария.“).
  - Then the next steps: „Реванш“ (a new duel the other way round, the player playing first) or „Още един срещу
    запис“; „Към Приятели“ plain. A duel that lapsed is its heading („Дуелът изтече“), who didn't play it in time, and
    the player's own game if they played it (`.duel-mine`).
- **Avatars:** `.avatar` (the drawn animal in its own colours in a round medallion of its scene, sizes `s` and `l`),
  drawn by `avatar()`.
- **In code:**
  - `ui.ts` has `avatar`, `who`, `rankRow`, `weekStrip`, `verdict`, `fact`, `explain`, `segmented`, `failure`,
    `rosette` and `topicMark`.
  - `game/run.ts` has `trail`, `questionHead` and `timer`.
  - `game/results.ts` has `summary`, `nextSteps` and `reviewParts`.
  - `game/mastery.ts` has `masteryCard` and the lines of a game's news.
- **Selectors:** give a part its own class (`.streak-num`) rather than a tag under a class (`.streak b`); Biome's
  `noDescendingSpecificity` flags the second kind. One class, one thing: a name already in `app.css` (`.back`, the
  way back; `.status`, a line of status) is taken, so a new part gets a name of its own. A class nothing names any
  more goes, with its rules.
- **Test hooks:** the browser tests depend on these classes; keep them:
  - `.question-head`, `.options .option`, `.number`, `.keypad`, `.sortable-list`, `.up-next`, `.verdict` and
    `.after`
  - `.issue`, `.issue-date`, `.issue-body`, `.result`, `.result-main`, `.score-n`, `.tomorrow`, `.share-sheet` and
    `.streak-chip`
  - `.summary`, `.reviewed`, `.news-open`, `.news-facts`, `.news-note`, `.mastery-line` and `.explain`
  - `.toc-row`, `.entry` (`.entry-word`, `.entry-q`), `.pager`, `.fig`, `.almanac-notes`
  - `.day-board`, `.rank-row`, `.friend`, `.invitation`, `.me-figures`, `.me-settings` and `.pick`
  - `.duel-head`, `.duel-verdict`, `.duel-face`, `.duel-points`, `.duel-marks .duel-pip`, `.duel-line`,
    `.duel-meant`, `.duel-record`, `.duels`, `.duel-row`, `.duel-sent`, `.their-line` and `.question-head .versus`

## Game feel

Every element that looks like a game measures something the game already counts:

| Element  | Measures                                                                                                                                                                                                                                    | Where                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Streak   | Days in a row with the day's ten, one missed day a week forgiven; the strip is this week's days played (`week` in `/api/me/stats`)                                                                                                          | Днес, the result, Профил         |
| Points   | One game's score, per answer and per run, from the server (with the parts for speed and for the row); a right answer about 1000; never added up across games                                                                                | Verdict, result, the day's board |
| In a row | Right answers in a row within a game, from the second (the flame and „3 поред“); each earns a tenth more, up to a half                                                                                                                      | Question head, verdict           |
| Place    | Place on the day's board                                                                                                                                                                                                                    | Приятели                         |
| Mastery  | Share of a topic's questions a player knows, from every answer weighed by its question's hardness (play/mastery.go); told after 10 answers, in six tiers: Новак, Любител (35%), Познавач (50%), Експерт (65%), Майстор (78%), Светило (90%) | Алманах, a chapter, the news     |
| Facts    | Facts collected in the book: a question's fact, with its first right answer                                                                                                                                                                 | Алманах, the news                |
| Notes    | Milestones noted in the book once each: a streak of 7, 30, 100 or 365 days, a first ten of ten on the day's questions, a chapter complete (every fact of a topic); with their day                                                           | The news, the Алманах's notes    |
| Duels    | Each on one's own time, with a friend (who has three days to play the same ten) or against a real recorded game; between two people, their record („3 : 2“)                                                                                 | Приятели, a duel's result        |
| Boards   | The day's ten, of all of България or of friends                                                                                                                                                                                             | Приятели                         |

**What a game brings** is quiet lines of what's true, in its news under the result:

- the facts it put in the book (`.news-facts`, „+3 факта в Алманаха“, a tap from them);
- how a topic's game moved its mastery when that's news (`.mastery-line`: a first estimate, a tier reached; never a
  loss);
- the notes it wrote in the book (`.news-note`, „Отбелязано в Алманаха: 30 дни поред с въпросите на деня.“);
- once a day, how others' duels against the player's recordings went („Твоите записи“).

Nothing of it is a sheet or has a sound of its own: a note too is a line (Motion). A game that ended without its
result on screen (the day's last question left to run out, a game left at its end) has its news told on Днес, once
(`play/told.go`).

Feedback fires once, when it's earned, and then the screen is still again: a right answer pops, a wrong one shakes
once, points rise counting up to what was earned, and an exact number answer gets the star.

## Flow

- **The game moves on by itself, and a tap moves it on sooner.** An answer shows in steps: the answer marked, the
  verdict with its points, then its fact, at the moment the player most wants it. It stays 3 seconds (4.5 for
  anything but a choice or „Вярно или невярно“, which have less to look at) plus the time to read the fact and the
  day's line (1.2 seconds and a little for each letter, 9 at most), with a line filling as it waits. „Напред“ is
  always there (Enter on a computer; „Към резултата“ after the last) and goes on at once. A question never opens in a
  tab that's out of sight.
- **A game has the whole screen.** The frame steps aside while a question or its answer shows, on every screen (and
  on a phone from the count before a run), so the pad and the verdict fit and a stray tap can't leave the game. Each
  question opens at the top of the page.
- **On a phone, the answers are at the thumb.** A run's question is a column the screen's height: the head, the pips
  and the clock at the top (kept there as the page scrolls), the question under them, and what answers it at the
  foot — the answers, „Вярно“ and „Невярно“, the pad with „Отговори“, or „Готово“ (which stays at hand on a screen
  too short for the rest).
  - The answer docks at the screen's foot, always in the same place: on paper under an ink rule, with the verdict,
    how everyone answered, the whole fact and „Напред“ across the width.
  - The answers move up above it, marked. The page moves only when they can't all fit, and then just enough to show
    the right one between the head and the panel.
  - A fact longer than the room scrolls with the panel, „Напред“ staying at its foot.
  - A phone on its side plays the same: the head small from the start, the question smaller, a choice's answers two
    by two and a choice of pictures four across.

  A tablet shows the answer under the question, and a laptop beside the answers (Wide screens).
- **Leaving a game is free between two questions.** While a question's time runs (on the server, so it can't wait),
  a way out asks first („Ако излезеш сега, въпросът остава без отговор.“, „Остани“ or „Излез“), and leaving gives
  that question up. The game waits where it stopped: the day on Днес with „Продължи“, a chapter's game for the next
  tap on „Играй главата“ the same day. No question's time starts without a tap; only a reload with one showing goes
  straight back into it.
- **What isn't the answer waits for the end.** „Нещо не е наред с въпроса?“ is in the review after the last answer,
  never between questions.
- **Time:** 20 seconds a question, 10 for „Вярно или невярно“, 30 for the ones with more to do (an order, „Свържи“,
  „Раздели“ and „Подсказки“). A question with pictures starts its time once they're in (it waits 8 seconds at most).
  When the time runs out, whatever has been put in (a typed number, things moved into an order, pairs joined, things
  sent to a side) is the answer.
- **Input without the phone's keyboard:** a number is typed on the game's own pad (a comma only where the answer may
  have decimals, a minus only for temperatures). Things to order are tapped (one picked up, then its place), dragged
  into place (by the grip on a touch screen, so the rest of a row scrolls the page) or moved with the arrow keys.
- **A screen reader plays too.** Each question takes the focus as it opens. An answer chosen keeps it (`aria-disabled`,
  not `disabled`, once answered); where the answering part goes (a pad, a list), „Напред“ takes it. A run has one
  live region, there from its start: it says each verdict once in plain words („Не е това. Вярно е: Бийтълс.“,
  „Вярно! +1040 точки.“) and each clue as it comes, never a countdown.
- **Touch:** there's no grey flash on a tap, and an answer gives under the finger. Hover, and anything it does,
  applies only where a pointer hovers (`@media (hover: hover) and (pointer: fine)`: `hover.test.ts`), so on a phone
  nothing looks chosen or current after a tap. Small drawn controls (the cross, „Върни последното“, an order's grip)
  still have 44px to tap.

## Copy

- **Language:** standard Bulgarian (Bulgarian words, never Russian ones: see `CLAUDE.md`), to one player with „ти“,
  in short plain sentences. Text must be gender-neutral: „Деси: още не“, „ако броят още те чака“, never „играл/а“.
- **Bulgarian words, not loanwords,** when a plain Bulgarian word says the same: „връзка“ or „покана“, not „линк“;
  „потребителско име“, not „таг“; „часовник“, not „таймер“. A loanword stays only where Bulgarian has nothing else in
  common use („имейл“, „аватар“), and never as slang. `language.test.ts` knows the ones that have slipped in.
- **Buttons** are verbs: „Започни“, „Отговори“, „Още десет“, „Сподели резултата“.
- **Verdicts** are a fixed set: „Точно!“, „Вярно!“, „Близо.“, „Не е това.“ and „Времето изтече.“
- **Numbers the Bulgarian way** (`formatNumber()`):
  - a space between thousands from 10 000 up („4812“, „12 500“);
  - a decimal comma („5,9“), and a space before a percent sign in a sentence („38 %“);
  - the minus sign „−“ below zero, never a hyphen („−89,2 °C“);
  - a unit after a space („15 с“);
  - ordinals with the ending the dictionary gives (`lib/ordinal.ts`): „1-ви“, „2-ри“, „3-ти“, „5-и“, „12-и“,
    „1872-ри“;
  - months in lower case, also after a word („Петък, 20 ноември“).
- **The day's issue** is said one way everywhere: „Брой 9 · 20 ноември“.
- **A bad game is never celebrated:** the result states it („Седем верни.“) and sets it beside Bulgaria.
- **No emoji in the interface.**

## Motion

- **Timings:**
  - presses 120ms; hover and colour 160–200ms;
  - the right answer's pop 360ms (to 1.04); the wrong answer's shake 320ms (4px);
  - an answer's points rise 520ms; a result's 800ms;
  - the clock runs linearly, and so does the ring of the three-second count before a chapter's game (with „Започни
    сега“ and „Откажи“, so a tap never throws the player straight into a question).
- **An answer shows in beats** (`beats` in `game/questions.ts`), the same however quick the line, all within a
  second:
  - The clock stops at the tap, and what was chosen stays chosen at least 280ms.
  - Then the player's own answer is judged (pop or shake), with its sound and its pip filling.
  - At 300ms the right answer is marked if it wasn't theirs, the rest dim, and the verdict docks with its points and
    the tally rising in step, all in one movement (240ms, `run.ts` settle). Where everything ends is worked out first;
    the answers glide up from where they were as the panel, opaque, rises with them, so the right answer is never
    under it. On a big screen the panel comes under the question and the page glides to show it the same way.
  - At 550ms the shares of everyone's answers grow behind them, their numbers fading in, with the sentence about them.
  - At 700ms the fact and „Напред“ appear.

  A run's head and its pips stay at the top of the screen while the question and its answer scroll, smaller once
  stuck, so the pip and the tally are seen landing.
- **A result lands, once** (`web/src/feel.ts`, at most 1.6s; a tap anywhere jumps to the end, and it never plays again
  on a reload):
  - The pips fill one by one (60ms apart, 85 on the day), each with a pluck a step up the scale for each right answer
    before it (so a good game climbs) and a muted thud for a wrong one.
  - As the last fills, the score lands (1.15→1) with the motif, and the points count up, holding their final width so
    nothing beside them moves.
  - On the day, once the score has landed, the streak's number rolls on from the day before (a first streak's comes in
    from nothing, never „0“), unlit till then, and lights with its sound.
  - Ten of ten: the pips sweep gold, „Всички верни“ appears, and the rosette is drawn as a seal petal by petal, the gold
    one last. All typographic: no particles.
- **A duel's result lands, once** (feel.ts `duel`, at most 1.6s, never again on that device):
  - The verdict waits while the marks fill pair by pair (75ms apart, a pluck for each of the player's right ones, a
    thud for each not), the two scores counting up with them so the lead changes hands as it did.
  - The band of the deciding question lights as it's reached.
  - At about 0.9s the verdict rises and the scores land, with `win`, `lose` or `end`; then the record fades in.
- **A note in the book is a quiet line** under the result (`.news-note`), never a sheet over it or a medal: the game
  that brought it may have gone badly (a streak's thirtieth day with two right of ten), and a bad game is never
  celebrated.
- **No ambient motion** and no confetti.
- **Reduced motion** („По-малко движение“, which follows `prefers-reduced-motion` until set): the pop, the shake, the
  rise, the transitions and the steps stop, and a result shows its end state at once, with their sound.
  The clock and the count before a run still move, because they are information.

## Sound

- **Made in the browser, in code** (`web/src/feel.ts`, loaded with the first touch; the switch and the turns in
  `web/src/lib/sound.ts`): there are no files to load and nothing to license.
- **One key:** every note is in D major pentatonic (D E F♯ A B), so sounds that follow each other sound like one
  piece. A right answer rises a step of the scale with each right one before it in a row, up to an octave.
- **The motif** D–A–F♯–D, as bells (four petals, the last one gold), is the game's audio logo: `end` plays it plainly,
  `perfect` (ten of ten) with a harmony and a little room, and `win` over a low D.
- **Four voices:** a bell (FM) for what's earned; a wooden pluck for the player's own touches; a soft thud for a wrong
  answer or none (never a buzzer); a short beep for the clock. Everything goes through a compressor, so sounds that
  meet can't clip.
- **Short:** an answer's sounds are over in under half a second; a moment's (the end, a duel's) may take up to 1.4
  seconds, as it comes once a game.
- **One sound per moment,** and only for game moments:
  - `tap` when an answer is given, and `key` for each key of the pad and each move in an order;
  - `right`, `exact`, `partial`, `wrong` or `time` with the verdict;
  - the clock, only near the end: silent until 10 seconds are left, then a soft `tick` a second, and `hurry` once a
    second for the last five, a step higher each („Тиктакане“ in Настройки turns it off);
  - `count` for each second of the count before a run, and `go` at its start;
  - `end` when a run's result opens (`perfect` for ten of ten), and `win` or `lose` at a duel's end;
  - `ping` when something new waits in Приятели (a friend's request, a friend's duel);
  - `them`, the other side of a duel answering, when played second (two soft low plucks, A4 then F♯4, off to the
    right, never a bell; only while the player hasn't answered).
- **Nothing plays** for navigation, hovering or decoration, and there is no music: people play on the bus or among
  others.
- **On by default,** with one switch in Настройки („Звуци“) kept on the device. The audio starts on the player's first
  touch, as browsers require; a sound that isn't allowed yet is skipped, never queued.

## Pictures

The game's illustrations — the avatars, the chapters, the duels, the book, Рила (for „България“) and the flame — are
drawn by hand as paths in `web/src/art/pictures.ts` and placed with `picture(id)` from `art/picture.ts`. They load as
a file of their own once the game starts, so the first screen never waits for them. They are used where they help (a
chapter's picture in its colour, the avatars in their medallions), never as decoration on the day.

- **One style:** flat shapes with depth, no outlines, lit from the top left. Depth comes from a lit half and a shaded
  half, a soft shadow set down and right, and a light on the top-left edge, never from gradients.
- **One ramp:** a picture is painted from one tone (a chapter's, an avatar's) in its inks: `k0` night ink, `k1` deep,
  `k2` shade, `k3` the tone, `k4` light, `k5` pale, `kw` white; `ks` a shadow and `kh` a light laid over; `kt` a tint
  of the tone for a ground; `l0`–`l5` the same inks as strokes. `.pic` in `app.css` mixes them from `--tone`, so a
  picture follows its chapter and the theme with no colour of its own.
- **What there is:** fifteen animals, every one anyone's avatar (лисица, мечка, котка, заек, таралеж, куче, елен,
  щъркел, жаба, мишка, катерица, овца, костенурка, язовец, рис), portraits cut at the medallion's bottom; a picture
  per chapter (a bulb, a flask, an amphora, a globe, a clapperboard, a record, a ball, a gamepad, a quill in its
  inkwell, a butterfly); a book for the Алманах; crossed swords for duels; the flame.
- **Art, not rules:** the pictures are a library the game draws from; the game's rules are `internal/play`'s, and a
  picture never changes them.
- **A new picture** is drawn on the 64 × 64 grid in the same inks and looked at beside the others, at its smallest
  size (an avatar at 24px) and in both themes, before it ships.

## Icons and the mark

- **Icons:** no icon font and no emoji. Icons are CSS masks drawn in `currentColor` (`--i-check`, `--i-cross`,
  `--i-close`, `--i-back`, `--i-left`, `--i-right`, `--i-search`, `--i-grip`, `--i-near`, `--i-clock`, `--i-star`,
  `--i-up`, `--i-flame`), each placed with `.i` and its name (`.i-close`). A new icon is a 24px drawing with round
  strokes, added the same way.
- **The mark** is the rosette: four petals, three in ink and one gold (`rosette()` in the bar and the masthead;
  `web/public/favicon.svg` on its tile). Use it as it is.
- **The share card** (`/card/<issue>-<shape>.png`, 1200 × 630, `internal/card`) is always on paper, whatever the
  theme: the rosette and the name, the issue, the double rule, the score as a hero numeral, the shape, „Колко ще
  познаеш ти?“, and „almanac.bg“ in a footer line. It never shows the answers. The shared text is „Алманах, брой 9 ·
  20 ноември / 7 от 10 ■■■□■■■□■□ / <link>“.

## Before a UI change ships

- **Look at it** on a seeded database (CLAUDE.md), by day and by night, at 320 and 390px and at 1366px, and on a
  phone at twice the text (Large text). Nothing may scroll sideways, and keyboard focus must show.
- **Run the checks:** `npm run check`, then the browser specs the change touches (`npx playwright test -c e2e
  --project=chromium e2e/<spec>`), and `e2e/a11y.spec.ts`, the accessibility checks.
- **Keep it light:** `go run ./cmd/build` says how big each file is, compressed, and holds the first screen to its
  budget. What a change adds should be worth its size.
