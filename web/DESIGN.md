# Design

АЛМАНАХ looks like the edition (DECISIONS.md, „The edition“): a publication a player keeps, not a generic game app.
Every day is an issue („Брой 9 · 20 ноември“); the player's progress is a book (chapters, entries, notes). Paper
first with a night of its own, serif headlines, numerals as the heroes, colour only where it means something, one
obvious action per screen, and game feel drawn only from what the game really counts. This file holds the rules. The
values live in `web/src/app.css` (the tokens at its top), and the pieces several screens share live in `web/src/ui.ts`.
Follow all three when you add or change a screen. Screens not yet in the edition's look speak its colours through the
old tokens' names (`--bg`, `--surface`, `--text`… at the top of app.css), until each is redrawn.

## Principles

- **A publication, not an app.** The structure is typographic: mastheads, ruled sections, a dateline, columns, a
  table of contents with leaders, a score sheet. No cards, no shadows, no gradients, no glows.
- **One obvious action per screen:** `.btn.primary`, a full-width bar of ink by day and lamp-gold by night
  (Започни, Напред, Сподели резултата, Играй главата). Everything else is a text link (`.link`) or an outlined
  button (`.btn`).
- **Colour only where it means something:** right (green), wrong (red), the one action, a chapter's own colour as a
  small accent (its kicker, its picture, its track), and the gold petal of the mark (today, in the streak's week, the
  caret). Everything else is ink on paper in three strengths.
- **Numbers are the heroes.** The date, the score, the streak, the share of a chapter known: set huge in the
  numeral face, tabular. Words around them are small and plain.
- **Game feel comes only from data the game has** (see Game feel below). No currencies, shops, unlocks or made-up
  numbers: what adds up across games is the Алманах (the facts collected, how well each topic is known) and the
  streak, and a note in the book is a fact of the player's games (DECISIONS.md, „The redesign“).
- **Few taps.** Every game starts one tap from where it's offered. Only a tap starts one: a game come to otherwise (a
  reload, back or forward, a link from outside) waits on a still screen (`startScreen()`, `.start-screen`: what it
  is, or where it was left with its pips, and „Започни“ or „Продължи“).
- **Leaving asks.** While leaving costs something (a question with its time running), every
  way out (a link, the browser's or a phone's back, the game's arrow) asks first, saying what it costs
  (`guardLeaving()`). A way back (`back()`, a game's arrow) goes back in the history when that's the page it points
  to, and never piles up an entry; back comes to a page scrolled where it was. A game left half-way says so where it
  starts (a duel, its row in Приятели: „Довърши своята игра“).
- **Phone first.** Every screen fits a 320px phone without scrolling sideways, with the text at its usual size and
  at twice it (see Large text), a 20px gutter.
- **A big screen is a spread, not a stretched phone:** from 56.25rem (900px) the gutter is 48px and the page up to
  1270px, two "pages" side by side divided by a vertical hairline; its rules live in `min-width` blocks and never
  change how a phone looks.

## Places

Three places (DECISIONS.md, „The redesign“): **Днес** (`/`), **Алманах** (`/almanac`) and **Приятели** (`/friends`).
Профил and Настройки open from the player's avatar in the bar's corner (`/me`, `/settings`). Nothing else gets a
place.

- **The frame** (`app.ts`): the bar (`.frame .bar`): the rosette (`rosette()`, three ink petals and one gold) and
  „АЛМАНАХ“ in Literata, spaced capitals, a way to Днес; on a big screen the three places as words (`.places`, the
  current one bold with a 3px ink underline), the issue on the right („Брой 9 · 20 ноември“, `.bar-issue`, except
  on Днес, whose dateline says it) and the avatar (`.bar-me`, 32px, round); without a profile (or on a new
  visitor's cover) „Вход“ there instead (`.bar-in`, to Профил's way in). The double rule under it (2px and 1px,
  2px apart). On a phone the three places are words at the foot (`.places-foot`, no icons; the current one bold
  with a 3px ink tab on its top rule; a dot on Приятели while someone asks to be friends). The frame steps aside
  while a game is under way (`html.playing`), and the places on a new visitor's cover (`html.cover`: Днес before any
  game begun).

- **Начало** (`/`): the day first. The streak (a way to Профил); the day's ten as the
  day's issue (`.masthead`: the weekday and „Брой 6“ on a hairline, the date set large, „17 ноември“, a hairline
  under it; then „Десет въпроса за днес“ a size down, what they are, and „Започни“; no pips before play: they'd
  measure nothing yet). The issue is the day's number from the first day of the day's ten (`play/issue.go`, 12
  November 2026 is Брой 1), the same for everyone. Left half-way, the same card with where the player stopped, „Следва въпрос 4 от 10“, the pips
  so far, and „Продължи“; or once played, as it lands, how they went (under the score the issue line, „Брой 6 · 17
  ноември“, and the way to the day's board; see The place, below) with the one gold thing to do next right under it
  (`game/gold.ts`: „Още десет“, to the topic the player has played least, by its answers; „Микс“ until that's
  known), „Прегледай въпросите“ beside it (a game is gone over on its own day only, `play.Review`); then tomorrow in
  one quiet card
  (`.tomorrow`: when the next ten come, what they make of the streak, and the reminder's ask); before the friends'
  day and the game's news. **A later visit** finds the day played, and its
  moment over: one short card (`.day-done`: the issue line and the place, the score a size down with its points, one
  line of how it went among everyone, the pips), „Още десет“ gold under it, „Прегледай въпросите“ (its own page,
  `/games/<id>`) plain; tomorrow; the friends' day after the ways to play (beside the day on a big screen). A result never on screen
  (the last question let run out) is the full one, once, with what it brought. Then the ways to play
  with others, three in a row (the picture over
  the name on a phone); the topics, two by two, „Микс“ (every topic at once) and „България“ first
  (`.topic-lead`, each with what it is under its name; „Микс“ across the row alone while „България“ is closed); on a
  big screen those two a row of their own, short tiles side by side, then the topics five to a row, the picture over
  the name, each tile as tall as what's in it. A day gone by isn't played again, nor its
  questions gone over: the day is today's (owner, 19 Nov 2026). The streak's chip shows only a streak; none at all
  rather than „0 дни поред“. A streak that ended is said once,
  over the day („Серията ти от 5 дни прекъсна. Днес започва нова.“): it isn't won back. A player back after days away
  (the streak ended since the last day played, `play.BackFrom`) is welcomed once, over the day: „Радваме се, че се
  върна. Най-дългата ти серия е 11 дни. Днес започва нова.“ Дуел opens from here and
  has a way back to it (`back()`). A player who hasn't finished a game yet sees only the day and the topics, and a
  quiet „Имаш профил? Влез“ (a new phone) that opens the sign-in in place (open from the start, above the day, for a
  browser signed out that came from the streak's mail, `/?from=mail`): the
  streak and the ways to play with others come after the first game (see First days). From the second day played, a guest is asked to keep the game in one line of the „Утре“
  card, said by what's at stake („Серията ти от 2 дни е само на това устройство. Запази я с имейл.“), the form opening
  in place. In an app's own browser (Messenger, Instagram …: `lib/embedded.ts`), where a guest's game would stay, it's
  asked on the first day, with the way out that carries the game: „Отвори в браузъра“ on Android, „Копирай връзката“
  (for Safari) on an iPhone (`/hand/<token>`, once, `account.Handoff`). The link takes nothing until „Продължи тук“
  is tapped, and then the game moves: the browser it came from no longer has it. A guest's Профил has „Играеш и на друго
  устройство? Влез с имейла си“ under the name.
- **The streak at stake.** While the day's ten wait, a streak (1 day or more: the second day is where a habit is won or
  lost) is at stake: its flame is unlit (`.streak-chip.unlit`, the number still there), and the day's card says what
  the ten make of it („Серия от 5 дни. С днешните въпроси става 6.“); from 18:00, if the week has forgiven its day already,
  that it ends („Серия от 5 дни. Прекъсва в полунощ, ако не изиграеш днешните.“, `.day-stake`). The day played lights the
  flame as its number rolls on (Motion). A topic's result, while the day waits, has „Към въпросите на деня“ as its gold
  button, the same line under it, and „Още десет“ plain.
- **The place** on the day's board (`game/standing.ts`) is a way to the board from two players, but not always said:
  on a player's first day, only in the better half or first, else the way is plain,
  „Класацията на деня“ (a new player's first social signal isn't last place). From ten players a share says how it
  went where the place isn't said, „По-добре от 35% от играчите днес.“; from a hundred it leads for everyone, the
  place still the way to the board („4312-о място“ alone says nothing). „Средно днес: 5,1 от 10.“ from ten players.
- **Sharing the day** („Сподели резултата“, plain, beside „Прегледай въпросите“ under the day's result and on its later
  card; `game/share.ts` does it, the screen draws it): the share sheet where the device has one, else the text copied
  and the button says „Копирано“ a moment. The text is „Алманах, брой 9 · 20 ноември“, „7 от 10 ■■■□■■■□■□“ (■ right,
  □ anything else; a question that counts for nobody has no square) and the link, `/d/<issue>-<code>`: never an
  answer, never a name. The link opens Начало: while it's that day, „Споделен резултат“, the score and its pips over
  „Колко ще познаеш ти?“ and „Започни“, the same ten; after, „Брой 8 вече мина. Ето днешния.“ Its preview is the card
  (`internal/card`): the edition's paper, whatever the theme.
- **Приятели** (`/friends`): the duels (`.duels`: „Твой ред“, a friend's waiting for the player, or their own to
  finish; „Чакаш“, sent and not played yet; „Изиграни“, the score and the record, „общо 5 на 3“; each a `.duel-row`
  to its page, with how long is left, „още 2 дни“, and „Нов дуел“ beside the heading), requests, friends, and the one
  way to add them: the field by потребителско име or имейл, „Добави“. A request is accepted or not („Поканата до
  Мария е изпратена.“): nobody becomes a friend alone. A friend's row is their name, their day, the duels between you
  and „Дуел“ (a duel with them, a tap away); „Промени“ shows „Премахни“ instead. A
  player still with the name drawn for them is asked for theirs once on a device, the first time others would see
  it: a sheet from the bottom (`.sheet`, `screens/name.ts`), the drawn name in its one field, „Не сега“ quiet (on
  with the drawn name). Before a first duel sent to a friend: „Как да те виждат останалите?“, „Готово“ gold.
  A name field never asks
  the browser for a full name (`autocomplete` nickname or off: `fields.test.ts`).
- **Алманах** (`/almanac`, `screens/almanac.ts`): the player's book, a spread on a big screen. „Твоята книга“, „Алманахът
  на <име>“ and when it began (the first game's day), three figures between rules (`.figures-row`: дни поред, факта,
  от всичко знаеш: Микс's share); the contents (`.toc`, two columns on a big screen): a chapter a row
  (`.toc-row.t-<topic>`) — its picture, its name in the serif on dotted leaders (`.toc-dots`, gone under `tight`) to
  the share known, and under it its facts, its tier (or „първа оценка“, „още без оценка“) and a 3px track in its
  colour (`.toc-track`); the ten topics, then „Микс“ (every topic) and „България“ (with its tricolour, `.flag`). Then
  the notes the book keeps (`.almanac-notes`, a ledger: the day in small capitals, the note in the serif; the streak's
  next milestone ahead in italic, „Тридесет дни поред, ако не спреш.“).
  **A chapter** (`/almanac/<topic>`): „← Алманах“, „Глава 3“ in its colour, its name, its picture; how much of it the
  player knows (`.know`: the share big, its tier in a sentence, „на крачка от „Експерт““ within 5%), its scale
  (`.scale`: a 4px track filled in its colour, a tick at each tier, a mark at the player, only Новак and Светило
  named); „Играй главата“ (the topic's game: topics are played from their chapter); then its facts as entries
  (`.entries`, two columns with a rule on a big screen): a dateline (`.entry-when`: „20 ноем. · Брой 9“, „Играй
  главата“, „Дуел“), the answer as a headword (`.entry-word`; a statement is its own, „Невярно:“ before one that isn't
  so), the question in italic (`.entry-q`), the fact (`.entry-fact`, a drop cap in the chapter's colour on the page's
  first). The latest first, thirty to a page (`.pager`: „← По-нови“, the numbers, „По-стари →“), found by their words
  (`.search`, at most 60 letters); the page and the search are in the address (`?page=2&q=…`).
  : the player (streak,
  numbers,
  the facts in the Алманах, mastery (once a topic has a mark; each row a way to play the topic), latest games (the
  day's ten as their issue, „Брой 7“, the date under it; today's each a way to go over it, read-only: `/games/<id>`,
  the score as its result had it and the questions; those of days gone by plain rows) and „Всички игри“ (`/games`:
  every game, by day under its dateline, Всички · Броеве · Теми · С други, a page at a time)). Настройки open from the button beside the name, its icon and its word at every width (an icon alone
  is read by few). The avatar is a tap from choosing another (`/avatar`, „Смени аватара“ under the name too): what's
  worn as others see it, then the fifteen animals, each in its own colours, every one anyone's from the first day, a
  tap wearing it.
  Общо is a hub, each thing once: the streak, three numbers in one card, the Алманах in a line („N факта в
  Алманаха“, a tap from it), mastery, the latest games and the way to all of them. Its head is the player's own
  avatar, as last seen on the device while it loads (never one drawn from the name: that reads as someone else's
  profile; a plain tile before any).

## First days

A new player meets the game a part at a time, by what they've done, never by the date:

- **The first day:** the day's result and its points (what points are, said once in a quiet line at the top of the
  first game's news, `.news-open`), the streak, the topics. Before a first game finished, Начало is the day and the
  topics only.
- **After a first game:** the ways to play with others.
- **A topic's first estimate** (10 answers): „Колко знаеш“ on Профил and the topic's tile say „първа оценка · 74%“,
  a game's news „Първа оценка: знаеш около 74% от темата“, a share and no tier; the tier („Експерт“) comes with a sure
  mark (30 answers).

**Points** say what they are where they first show, and a tap from wherever they do (`explain()`: the word dotted
under, its meaning in a small card over the page; the words are `meaning` in `ui.ts`): one game's score (right
answers, speed); the day's board is by them (after the right answers). There's no rating: a duel's is its record
between two people.

## Space and size

- **Spacing** comes from the scale (`--space-1` … `--space-7`: 4, 8, 12, 16, 24, 32, 48): 24 between a screen's
  sections, 16 inside a card and between a section's title and what it heads, 8 between tiles of one grid.
- **Cards** have 16 of padding (`.card`), the hero 20.
- **Tiles** (a way to play, a topic) are a picture at 44–48px beside the name, at least 68px high, two to a row.
- **Touch targets** are at least 44px high; the bar's are its full height. A link on its own line is `.link.tap` (a
  way on in `.day-next` is one by itself); what is drawn smaller gets its room around it (a pill's padding through
  `::after`, a row's or the header's height through padding and a negative margin), so the layout doesn't change for
  it. A link inside a sentence is read where it is, the line's height. `e2e/text.spec.ts` tries each control with a
  finger's reach.

## Large text

The text grows with the browser's own setting and with „Размер на текста“ in Настройки → Достъпност („Обичаен“,
„Едър“ 125%, „Много едър“ 150%: `lib/prefs.ts`), the two multiplied, at most twice the usual. Everything is sized in rem from `<html>`, so a screen at twice the text on a 320px phone is a screen
on a phone 160px wide; it holds that way (`e2e/text.spec.ts`):

- **Display type grows at half the rate** (titles, the date, the question, the big numbers): set as half px, half rem
  (`calc(17px + 1.0625rem)` for 34px), the same at the usual size. A drawn mark (the fact's „?“) keeps its px.
- **Nothing is wider than its column:** one-column grids are `minmax(0, 1fr)`, not `1fr` or `auto` (a long word
  breaks, `overflow-wrap`, rather than widening the page); a row of things wraps (`.verdict`, a run's head).
- **Rows give way to columns** once the column holds few words: `lib/prefs.ts` measures the column in em and puts
  `tight` on `<html>` under 17em and `tighter` under 13.5em (at the usual size even a 320px phone's is 18em). Under
  `tight`: topics and the ways to play one to a row, a board's score under the name, an
  answer gone over with how it went on a line under its words, „Вярно“ over „Невярно“, switches of choices and
  Профил's places on two lines, the answers as tall as their words (the four in sight). Under `tighter`: the bar of places shows its pictures alone (the names stay for screen
  readers); a pair's mark sits over its words; a choice keeps the room for its share and its ✓ or ✕ at its foot,
  not its end; and a run's answer comes under the answers, as on a tablet, not docked at the screen's foot (there it
  would leave no room for the right answer and its fact both).
- **A word breaks only where it's wider than its cell,** at its syllables where the game knows them (a pair, a thing
  to sort, a group: `wholeWords()` in `game/questions.ts`), never „Каралий-|чев“ where „Каралийчев“ fits the next line,
  nor „Шве|ция“. Every control is a scroll away and every answer can be read (`e2e/text.spec.ts`). Not a container query: Chromium doesn't always ask a rem one again as the root's size changes.

## Wide screens

- **48rem (a tablet):** the column grows to 48rem; the places move into the header; in a game the question and its
  answers are bigger, and a choice's answers sit two by two (a list stays one column: an order, pairs, groups). The
  number's field and pad stay a phone's width. A page's picture sits beside its heading and lead, not over them.
  A page's buttons are a hand's width (22rem), not the column's, at its left, the gold one first: the day's, a page's
  own, Начало's cards', and a group of them (`.actions`: under a result, Дуел's) side by side where two fit, the plain
  ones after the gold one and as tall as it, a line about the gold one under it. Начало's and a result's quiet lines sit
  at the left with them, as on a phone, never centred.
- **64rem (a laptop):** the page is up to 76rem wide with a 32px gutter. Начало is two columns: the day (or its result,
  „Още десет“ beside „Прегледай въпросите“; just played as after a reload), and under it the topics, five to a row;
  beside them, at most 22rem wide, the streak first, level with the day, on a row of its own with its number big (the
  habit's reward is no small chip in a corner), then the ways to play with others, one under another. A new player, with only the day and the topics (the ways in are lines under the day), gets one centred
  column. Профил's places are 64rem wide: Общо's cards in two columns, read
  top to bottom; bigger avatars to choose from, more to a row. Every other page is a centred column of 48rem, so no
  line of text runs too long; a game is 54rem, with bigger type still. A run's question (the day, a topic) takes the
  page's width in two columns: the head, the question and its answers on the left, and on the
  right, from the question's start, the column its answer comes into (see Flow); on a laptop's height a choice of
  pictures is four across.
- **A computer** (a fine pointer that hovers) is shown its keys: beside each answer's letter its key, 1–4 (the same
  on every keyboard layout; the letter stays А–Г on every screen), „Вярно“ and „Невярно“ 1 and 2, the count before a
  run Enter („Започни сега“) and Esc („Откажи“), and an answer shown Enter (on at once). The marks are `.key-hint`,
  only where a key works: never on a question gone over or one shown to be looked at (`ask(…, display)`: a review's),
  nor on an answer once it shows.

## Colour

Day (paper) is on `:root`; Night replaces it under `prefers-color-scheme: dark`, unless Day is chosen, and wherever
Night is chosen („Изглед“ in Настройки: `data-scheme` on `<html>`, `lib/prefs.ts`). So each Night rule is written
twice, `:root:not([data-scheme="day"])` under the media query and `:root[data-scheme="night"]` outside it
(`scheme.test.ts` holds them equal). Night is not the day inverted: a deep blue-black page under a lamp, so the one
action turns lamp-gold and the numerals paper-white. Never call this choice „Тема“: in the game a „тема“ is what
questions are about. A rule never holds a literal colour: it takes a token.

| Token                                      | Day                               | Night                             | Use                                               |
| ------------------------------------------ | --------------------------------- | --------------------------------- | ------------------------------------------------- |
| `--paper`                                  | `#f6f1e7`                         | `#121620`                         | the page                                          |
| `--paper-2`                                | `#ede6d8`                         | `#1a1f2b`                         | the player's own row, a pressed option, a well    |
| `--paper-3`                                | `#e3dac8`                         | `#242a38`                         | a pressed key                                     |
| `--ink`                                    | `#1c1915`                         | `#eee7d8`                         | text, headings, numerals, filled squares          |
| `--ink-2`                                  | `#4a443b`                         | `#c4bcad`                         | decks, secondary text                             |
| `--ink-3`                                  | `#675f53`                         | `#9c9586`                         | kickers, meta, labels                             |
| `--rule`                                   | `#d9cfbd`                         | `#2a3040`                         | hairlines between rows, tracks                    |
| `--rule-2`                                 | `#8f8169`                         | `#68728a`                         | control outlines (an option's ring, a switch off) |
| `--rule-ink`                               | `#1c1915`                         | `#c4bcad`                         | section rules, the double rule                    |
| `--action` / `--on-action`                 | `#1c1915` / `#f6f1e7`             | `#e8b84b` / `#17130a`             | the one action                                    |
| `--right` / `--right-ink` / `--right-wash` | `#2f8a57` / `#1e6a43` / `#e2eedf` | `#5fc08e` / `#7fd3a6` / `#173127` | a right answer: its mark, its words, its row      |
| `--wrong` / `--wrong-ink` / `--wrong-wash` | `#c2493a` / `#a8372a` / `#f6e2db` | `#e9796a` / `#f2907f` / `#38201f` | the same for a wrong one                          |
| `--gold` / `--gold-ink`                    | `#d9a21b` / `#855b00`             | `#e8b84b`                         | the mark's petal, today's square, the caret       |

- **Chapters** keep one colour everywhere, the cloth of each chapter's binding (`--t-<topic>`, set as `--t` by
  `.t-<topic>`; text-safe on paper and paper-2 in both themes): general `#87600f`/`#d9ae55`, science
  `#1f6e76`/`#6cc0c8`, history `#8c3a2e`/`#e08c7d`, geography `#4f682a`/`#a9c277`, movies `#7a4580`/`#c99ace`, music
  `#3b55a0`/`#94a9ec`, sports `#9a481b`/`#ee9a68`, technology `#43648a`/`#91b2d8`, literature `#9c3f60`/`#e596b2`,
  nature `#376e41`/`#8ccb95`, Микс `#57514a`/`#bdb6ac`, България `#2e6b4c`/`#7cc59e`. A chapter's drawn picture takes
  its colour as `--tone`, so a picture always sits in its chapter.
- **Right and wrong never rest on hue alone:** a ✓ or ✗ in a disc, a filled or an open square, and the words.
- **Contrast:** text holds at least 4.5:1 on `--paper` and `--paper-2` in both themes, control lines 3:1.
  `e2e/a11y.spec.ts` checks text with axe.

## Type

- **Faces**, our own files in `web/src/fonts` (SIL OFL 1.1; never a font from another host: the CSP allows
  `font-src 'self'` only), each cut to a file for Bulgarian and one for the rest (`subset.sh`, `fonts.test.ts`):
  - Literata roman 400–700 (`--font-serif`): headlines, the question, the name in the bar, facts and entries.
  - Literata italic 500: decks, the month beside a date, a question under its answer, notes.
  - Sofia Sans 400–900 (`--font-sans`): interface text, buttons, kickers, labels. With `lang="bg"` it draws the
    Bulgarian letter forms (д, л, т); keep them.
  - Sofia Sans Extra Condensed 600–900 (`--font-numeral`): every numeral that matters, with tabular figures. It is
    for digits only: a word beside a big number (7 „от“ 10) is in the words' face, small, on its baseline
    (`.num-word`).
- **Scale** (phone / big screen; display type grows at half the rate the text does: Large text):
  - the hero numeral (the date, the score) 132–200 / 260–400px, 800, line 0.8;
  - a big figure (the streak, a chapter's share) 64–84px, 800;
  - `h1` 34 / 54px, Literata 600, −0.012em; the question 25 / 40px; `h2` 25 / 32px; a section's heading 20px;
  - a deck (`.deck`, `.lead`) 18 / 21px, Literata italic 500, `--ink-2`;
  - body serif (facts, notes) 16.5–19px, line 1.5; UI 16px, an option 19 / 21px;
  - small and meta (`.small`) 14px, `--ink-3`; a kicker (`.kicker`) 12px, 700, capitals with 0.14em;
  - the name in the bar 15 / 17px, Literata 600 capitals with 0.2em.
- **Case:** sentence case everywhere. Capitals come only through `.kicker` and `.tag`.

## Shape and depth

- **Space** on a 4px base: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 (`--space-1` … `--space-8`). A section is 48px from
  the last; inside, 8–16.
- **Rules:** a hairline (1px `--rule`) between rows; an ink rule (1px `--rule-ink`) under a section's heading; the
  double rule (2px and 1px, 2px apart) under the bar and a masthead; a 2px ink underline for a field or the typed
  number.
- **Corners:** 3px on buttons and controls (`--radius`), 2px on squares, round for avatars and marks. Nothing else
  is rounded.
- **No depth:** no shadows, no glows. What's raised is said by a rule or a wash.
- **Focus:** one rule for everything (`:focus-visible`): a 2px ink outline, 2px off the edge. A field shows its
  focus by its underline turning gold.

## The pieces

- **Layout:** `.screen`, `.stack`, `.intro`, `.title-row`, `.card` (with `.card-head` and `.card-title`) and
  `.card.hero`.
- **Getting around:** `.tabs` (the four places), `.back` (drawn by `back()`), `.subnav` (Профил's places, drawn by
  `profileNav()`), `.me-settings` (Настройки: an icon and its word, the word under the icon on a narrow phone) and `.more` (a `details` that
  folds what's rarely needed; what it holds is spaced as a section's parts).
- **Начало:** `.status-row` with `.streak-chip`; `.card.hero.day` opening with `.masthead`
  (`.masthead-line`, `.masthead-date`) over `.day-title`; `.modes .mode` and `.topics .topic` (`.topic-lead` for
  „Микс“ and „България“, `.topic-all` across the row).
- **Page openers** lead with the thing, not its rules. A lead is one sentence.
- **Text:** `.kicker`, `.lead`, `.muted`, `.small`, `.bad` (errors) and `.status`; `.explain` with `.explain-pop`
  (a number's name, a tap from its meaning: `explain()`).
- **What went wrong** is never a dead end: `failure()` (`.failure`) says it, offers „Опитай пак“ (gold) only where
  trying again can help (no line, the server for a moment), tries again by itself as the line comes back, and has a
  way on („Към Начало“, or the screen's own place). In a run it keeps the run's frame (the head with its arrow, the
  pips) and its clock: a step that doesn't get through is tried again quietly first.
- **Controls:**
  - `.btn`, with `primary`, `big`, `rose` (accepting a friend request), `danger` and `inline`, all with one corner
    (`--radius-md`); and `.link` (`tap` for one on its own line, a finger's height).
  - Like things are one size: a field is a button's height (48), an answer row 60 whatever the question's kind, a
    meter 6, a row card 12 by 16 inside; every number of a size is from the scale.
  - `.field` and `input.code`; `.join` for an input with its button.
  - `.segmented` (`segmented()` in `ui.ts`): tabs that switch what a screen shows, or, as radios, a setting's few
    choices („Размер на текста“). Never a native select, radio or checkbox. A setting
    that is on or off is a `switchRow` in Настройки: the whole row (a label) is its to tap.
  - `.tag` and `.chip`; `.chips.scroll` for a row of chips that scrolls sideways on a phone (the page itself never does);
    with a mouse or on a tablet and up it wraps, every chip in sight.
- **Numbers:** `.figures`/`.figure`, `.stats`/`.stat`, `.streak` (with `.week`), `.games`/`.game`.
- **Mastery:** `.mastery` (the tier's bars, lit in the topic's tone, and its name), `.mastery-list`/`.mastery-row`, and
  `.mastery-line` (how a topic's game moved it) in a result's news.
- **Play:**
  - `.question-head` (with `.count`, which never wraps; `.versus`, the friend in a duel with one; and `.game-leave`,
    the way out on a phone), `.leave-layer` with `.leave-ask` (asked to leave, in a sheet at
    the foot over the answers, „Остани“ gold, the clock running in sight above it), `.trail`, `.timer` (muted while
    there's time, `.soon` gold for the last ten seconds of a question longer than ten, `.low` red for the last five,
    `.stopped` grey once answered) and `.ask`; in a run, `.question-top` holds the head, the pips and the clock, and
    on a phone `.answering` is set at the foot and `.after` (the answer: verdict, fact, „Напред“) docks under it.
  - `.picture` over a question, its box the picture's own (no wider than the column), a hairline `--line` inside its
    edge so a white flag holds on a white card, on `--sunken` while it loads: while it's asked, `picture(view, true)` keeps it low enough for the question, the
    picture and the whole answering part to fit on the screen (no less than 128px); a question's time starts once
    its pictures are in.
  - `.options .option`, with the states `picked`, `placed`, `right`, `wrong` and `dim`; and `missed`, a row of a right
    answer the player didn't have (an order, pairs, groups): plain, with a hollow ✕ and „ти: …“ for what they gave.
    A choice's (`.choices`) keep the room at their end from the start for what the answer brings there, the share
    that gave each and its ✓ or ✕ at the far end (where a computer's key waits): nothing re-wraps as they come.
  - „Раздели“: `.split` with `.split-deck` (the thing now on a `.split-card`, the next one `under` it; dragged, it
    names the group it's going to), `.split-sides` (the two groups as `.option.split-side`), `.split-pips` and
    `.split-back`; afterwards `.split-result`.
  - A choice of pictures: `.options.pic-options` (two by two), each `.option.pic-option` a picture with its letter
    (`.pic-letter`) and, once answered, its name (`.pic-name`) and the share that gave it on its corner (it doesn't
    grow); the pictures' credits in `.pic-credits`.
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
- **Players:**
  - `.avatar` (a picture on a tile of its tone `tone-…`, sizes `s` and `l`), drawn by `avatar()`.
  - `.who` (avatar and name) for a player on a board or a list, drawn by `who()`.
  - `.worn` (what's worn), `.picker`/`.pick` and `.tone-pick` for choosing an avatar (`/avatar`).
  - `.place-link` (a line in Профил a tap from a place: the Алманах).
- **Results:** `.summary`, `.board`/`.row` (with `p1`–`p3`, `me` and `gap`), `.topics`/`.topic`,
  `.players` and `.settings`. Every result screen (the day, a topic, a duel) is laid out the same:
  the result; right under it what to do next (`nextSteps`): the one gold `big` button (the day's by `game/gold.ts`; a topic's „Още
  десет“, at once without a count, with „Друга тема“, three topics as chips, under the buttons; „Още един дуел“, „Нова
  игра“), then the others as plain buttons of one size, side by side where they fit
  (`.result-actions`: „Прегледай въпросите“ first); then the game's news; and at the end the questions, once
  opened (the button takes the player there). Each question gone over is a card of its own (`.reviewed`, a band in
  its verdict's colour on top): its number and topic as a kicker with „Вярно“, „Близо“ or „Грешно“ beside them, the
  question the strongest line, the answers marked, and the fact a quiet note under them.
- **A duel's result** (`screens/outcome.ts` with `outcome.css`, loaded as a duel starts), one card (`.duel-end`): the
  kicker („Дуел с Мария“, „Дуел срещу запис“) and the verdict (`.duel-verdict`: „Победа“, „Загуба“,
  „Равенство“); the two face to face
  (`.duel-face`: the big avatar, the name a way to the profile, „Запис“ for a recording, the points and
  the right answers; the winner's points gold and its avatar glowing, the other's plain; a player gone since, a dash
  and „Играчът вече го няма“); the duel question by question (`.duel-marks`: the player's row over the
  other's, each beside a small avatar; the quicker of two right answers ringed in gold, `.fast`, said once under
  them; a gold band behind the question that decided it); one line of what decided it (`.duel-line`: „Водеше от
  8-ия въпрос до края.“, „Мария водеше от първия въпрос до края.“, „Реши го последният въпрос.“, „Равни точки: реши
  времето (…)“, a second or more apart, „Равни точки и под секунда разлика във времето.“ for a draw); and what it
  meant under a hairline (`.duel-meant`: the record against this person, „Срещу Мария 3 : 2“, in rose; against a
  recording, whose game it was, „Записът е от истинска игра на Мария.“). Then the next steps: „Реванш“ gold (a new
  duel the other way round: the player plays first), or „Още един срещу запис“; „Към Приятели“ plain. A duel that
  lapsed is its heading („Дуелът изтече“) and who didn't play it in time („Мария не изигра дуела за трите дни.“), and
  the player's own game if they played it (`.duel-mine`).
- **A duel played** (`screens/duel.ts`): as any game (`game/run.ts`), „Дуел с Мария“ over each question
  (`.question-head .versus`). Played second (or against a recording), the other's answer shows as they gave it: the
  line over the question turns „Мария отговори“ at the moment they did (with the sound `them`), and once the
  player's own answer is in, how it went for them under the verdict (`.their-line`: „Мария: вярно за 4,2 с“, in the
  right answer's green; „грешно“, „близо“, „без отговор“ muted). Their points wait for the end. Played first, the
  result is the player's own (`summary`), a line in its card under the duel's name that it's sent (`.duel-sent`:
  „Изпратен. Мария ще изиграе същите десет въпроса: има време още 3 дни.“). „Нов дуел“ (`/duel/new`): each friend a row („Покани“), and „Играй срещу
  запис“.
- **Friends:** `.card.friends`, `.invitation` (a friend request, accepted with `.btn.rose`), `.friend-list`/`.friend`
  (with `.friend-day` and `.record`).
- **In code:**
  - `ui.ts` has `verdict`, `fact`, `streak`, `stat`, `figure`, `meter` and `toneOf`.
  - `game/mastery.ts` has `masteryBadge`, `masteryCard` and `masteryMoves`.
  - `game/run.ts` has `trail`, `questionHead` and `timer`.
  - `game/results.ts` has `summary`, `nextSteps`, `review`/`reviewParts`, `board` and `boardRow`.
- **Selectors:** give a part its own class (`.streak-num`) rather than a tag under a class (`.streak b`). Biome's
  `noDescendingSpecificity` flags the second kind. One class, one thing: a name already in `app.css` (`.back`, the
  way back; `.status`, a line of status) is taken, so a new part gets a name of its own (`.key.erase`, `.status-row`).
- **Test hooks:** the browser tests depend on these classes; keep them:
  - `.question-head`, `.options .option`, `.number`, `.keypad` and `.sortable-list`
  - `.up-next`, `.summary`, `.reviewed` and `.verdict`
  - `.players li`, `.friend` and `.invitation`
  - `.modes`, `.topics` and `.streak-chip`
  - `.news-open`, `.news-facts`, `.news-note`, `.mastery-line`, `.almanac-notes` and `.explain`
  - `.toc-row`, `.entry` (`.entry-word`, `.entry-q`), `.pager`, `.fig`, `.day-board`, `.rank-row`
  - `.duel-head`, `.duel-verdict`, `.duel-face`, `.duel-points`, `.duel-marks .duel-pip`, `.duel-line`,
    `.duel-meant` and `.duel-record`
  - `.duels`, `.duel-row`, `.duel-sent`, `.their-line` and `.question-head .versus`

## What a game brings

- **The Алманах and the streak are the whole of progress** (DECISIONS.md, „The redesign“): no XP, levels, goals,
  achievements, titles, frames, patterns or unlocks. After a game, its news is quiet lines, of what's true: the facts
  it put in Моят Алманах (`.news-facts`, „+3 факта в Алманаха“, a tap from them: what playing gives that only goes
  up); how a topic's game moved its mastery when that's news (`.mastery-line`: a first estimate, a tier reached;
  never a loss); and the notes it wrote in the book (`.news-note`, „Отбелязано в Алманаха: 30 дни поред с въпросите
  на деня.“): a streak of 7, 30, 100 or 365 days, a first ten of ten on the day's questions, a chapter complete (every
  fact of a topic). A note is the one thing big enough for a sheet over the result (Motion: its number set large, or
  the chapter's picture; „Отбелязано в Алманаха ти.“), and its sound. A bad game is never celebrated: there's nothing
  to cheer but what's true. In a card of its own, once a day, how others' duels against the player's recordings went
  („Твоите записи“). A game that ended without its result on screen (the day's last question let run out, a game
  left at its end) has its news told on Начало, once, under „От последната ти игра“, with no sheet or sound
  (`play/told.go`).
- **The streak** forgives a missed day a week by itself, said under it in Профил (`.streak-note`, the day forgiven
  on the week's strip: `.week li.forgiven`); a day forgiven, or a streak that ended, is said once on Начало
  (`.streak-notice`; told once on the server, not once per device), as is, one at a time, what others did meanwhile:
  a friend said yes to a request („Мария прие поканата ти за приятелство.“ and „Приятели“). While a friend's duel
  waits for the player, Начало says so in the same quiet line, first („Мария те покани на дуел.“ and „Играй“; „2 дуела
  те чакат.“ and „Приятели“), and Приятели has a dot in the bar.
- **Every avatar is free:** fifteen animals (`play.Shapes`), each in any of six colours (the theme's five and
  „естествени цветове“, `.tone-natural`: every part in its own colour).

## Flow

- **The game moves on by itself, and a tap moves it on sooner.** Alone (the day, a topic), an answer
  shows in steps: the answer marked, the verdict with its points, then its fact („Знаеше ли?“), at the moment the
  player most wants it. It stays 3 seconds (4.5 for anything but a choice or „Вярно или невярно“: there's more to
  look at) and the time to read the fact and the day's line (1.2 seconds and a little for each letter, 9 at most),
  with a line filling as it waits; „Напред“, always there (Enter on a computer; „Към резултата“ after the last), goes
  on at once. A question never opens in a
  tab that's out of sight.
- **A game has the whole screen.** On a phone the header and the bar of places step aside from the count before a
  run, and while a question or its answer shows (an arrow before the count goes home), so the pad and the verdict fit
  and a stray tap can't leave the game. Each question opens at the top of the page.
- **On a phone, the answers are at the thumb.** A run's question is a column the screen's height: the head, the pips
  and the clock at the top (kept there as the page scrolls), the question under them, and what answers it at the
  foot — the answers, „Вярно“ and „Невярно“, the pad with „Отговори“, „Готово“ (which stays at hand on a screen too
  short for the rest, a laptop's too). The answer docks at the screen's foot, always in the same place: the verdict,
  how everyone answered, the fact whole (on its date, the day's line run on from „На този ден“) and „Напред“ across
  the width; the answers move up above it, marked, and the page moves only when they can't all fit, just enough to
  show the right one between the head and the panel. The panel always leaves the right answer that room; a fact
  longer than the rest scrolls with the panel, „Напред“ staying at its foot. A phone on its side plays the same,
  the head small from the start (or from when the phone is turned), the topic still in it, the question smaller, a
  choice's answers two by two and a choice of pictures four across, so that they start on the screen; its panel has
  how everyone answered and „Напред“ on the verdict's row, so the fact under them shows. A laptop shows the answer
  beside the question: the question and its answers stay on the left, where they were asked, and the verdict, how
  everyone answered, the fact and „Напред“ come into the column on the right, held in sight from the top of the
  screen, so nothing scrolls for the fact (a fact longer than the screen scrolls in its column, „Напред“ at its foot);
  the page moves only for a right answer below the screen. A tablet shows the answer under the question; the page
  moves for it, but never the question's first line under the head unless the verdict wouldn't show, „Напред“
  staying at the screen's foot.
- **Leaving a game is free between two questions.** While a question's time runs (on the server, so it can't wait),
  a way out — the arrow, a place in the header — asks first („Ако излезеш сега, въпросът остава без отговор.“,
  „Остани“ or „Излез“), and leaving gives that question up. The game waits where it stopped: the day on Начало with
  „Продължи“, a topic's game for the next tap on that topic the same day. No question's time starts without a tap;
  only a reload with one showing goes straight back into it.
- **What isn't the answer waits for the end.** „Нещо не е наред с въпроса?“ is in the review after the last answer
  (of a run or a duel), never between questions; so are the facts of a game played with others, where
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
- **Touch:** no grey flash on a tap; an answer gives under the finger (98%, the accent edge); hover, anything it
  does, only where a pointer hovers (`@media (hover: hover) and (pointer: fine)`: `hover.test.ts`), so on a phone
  nothing looks chosen or current after a tap. Small drawn controls (the arrow out of a stuck
  head, „Върни последното“, an order's grip) still have 44px to tap.

## Game feel

Every element that looks like a game measures something the game already counts:

| Element  | Measures                                                                                                                                                                                                                                    | Where                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Streak   | Days in a row with the day's ten, one missed day a week forgiven; the strip is this week's days played (`week` in `/api/me/stats`)                                                                                                          | Начало, Профил             |
| Points   | One game's score, per answer and per run, from the server (with the parts for speed and for the row); a right answer about 1000; never added up across games                                                                                | Verdict, result, day board |
| In a row | Right answers in a row within a game, from the second (the flame and „3 поред“); each earns a tenth more, up to a half                                                                                                                      | Question head, verdict     |
| Place    | Place on the day's board („12-и от 318 днес“)                                                                                                                                                                                               | Днес, Приятели             |
| Mastery  | Share of a topic's questions a player knows, from every answer weighed by its question's hardness (play/mastery.go); told after 10 answers, in six tiers: Новак, Любител (35%), Познавач (50%), Експерт (65%), Майстор (78%), Светило (90%) | Игра, Профил, result       |
| Notes    | Milestones noted in the book once each: a streak of 7, 30, 100 or 365 days, a first ten of ten on the day's questions, a chapter complete (every fact of a topic); with their day                                                           | Result, Моят Алманах       |
| Duels    | Each on one's own time, with a friend (who has three days to play the same ten) or against a real recorded game: won of played; between two people, their record („3 : 2“)                                                                  | Приятели, Профил           |
| Boards   | The day's ten, of all of България or of friends                                                                                                                                                                                             | Приятели                   |
| Friends  | The day's board among you and your friends, once a friend has played                                                                                                                                                                        | Приятели                   |
| Avatars  | A picture on a tone: fifteen animals and six colours, every one anyone's from the first day                                                                                                                                                 | Everywhere a player is     |

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
  - the minus sign „−“ below zero, never a hyphen („−89,2 °C“, as the pad has it; `formatNumber()`);
  - a unit after a space („15 с“);
  - ordinals with the ending the dictionary gives (`lib/ordinal.ts`): „1-ви“, „2-ри“, „3-ти“, „4-ти“, „5-и“, „12-и“,
    „21-ви“, and „3-то място“;
  - months in lower case, also after a word („Алманах за ноември 2026“).
- **The day's issue** is said one way everywhere (`issueWords()` in `lib/words.ts`): „Брой 6 · 17 ноември“, the
  result's line and Моят Алманах's days.
- **No emoji in the interface.**

## Motion

- **Timings:**
  - presses 120ms; hover and colour 160–200ms;
  - the right answer's pop 360ms (to 1.04); the wrong answer's shake 320ms (4px);
  - an answer's points rise 520ms; a result's 800ms;
  - the timer runs linearly with the clock, and so does the ring of the three-second count before a topic's run
    (with „Започни сега“ and „Откажи“, so a tap on a topic never throws the player straight into a question).
- **An answer shows in beats** (a run's: the day, a topic; `beats` in `game/questions.ts`), the
  same however quick the line, all within a second: the clock stops at the tap, and what was chosen stays chosen (its
  accent ring) at least 280ms; then the player's own answer is judged (pop or shake), with its sound and touch and its
  pip filling (0.6→1, 200ms); at 300ms the right answer is marked if it wasn't theirs, the rest dim, and the verdict
  docks with its points and the tally rising in step, all of it in one movement (240ms, `run.ts` settle): where
  everything ends is worked out first, the head at the size it will have there (made smaller, its count, tally, pips
  and arrow glide to it in the same movement), and the answers glide up from where they were as the panel, opaque
  (only its transform moves: nothing shows through it), rises with them (from 24px below, or as far as they move), so
  the right answer is never under it; brought up from out of sight, it pops once it's there. The tally's line is
  there from the first question, before there are points, so the head never grows when they come. On a big screen the panel comes under the answers
  and the page glides to show it the same way. At 550ms the shares of everyone's answers grow behind them, their
  numbers fading in, and the sentence about them; at 700ms the fact and „Напред“. A run's head (the count, the
  topic, the tally, the clock) and its pips stay at the top of the screen while the question and its answer scroll,
  smaller once stuck (the clock a thin bar along its edge, the seconds at the pips' end; stuck a few pixels past the
  top, back only at it, so it never flickers), so the pip and the tally are seen landing.
- **A result lands, once** (`web/src/feel.ts`, at most 1.6s, a tap anywhere jumps to the end, never again on a
  reload): the pips fill one by one (60ms apart, 85 on the day; each with a pluck a step up the scale for each right
  answer before it, so a good game climbs, and a muted thud for a wrong one); as the last fills (at 700ms, about 0.9s
  on the day) the score lands (1.15→1) with the motif and the points count up; on the day, once it has landed, the
  streak's number rolls from the day before (a first streak's comes in from nothing, never „0“) with the flame, unlit
  till then, lighting and swelling once and its sound. Ten of ten: the pips sweep gold, „Всички верни“ and the
  rosette as a seal, drawn petal by petal, the gold one last. All typographic: no particles.
- **A duel's result lands, once** (feel.ts `duel`, at most 1.6s, a tap jumps to the end, never again on that
  device): the verdict waits while the marks fill pair by pair (75ms apart, a pluck for each of the player's right
  ones, a thud for each not), the two scores counting up with them so the lead changes hands as it did, the band of
  the deciding question lighting as it's reached; at about 0.9s the verdict rises and the scores land, the winner's
  turning gold, with `win`, `lose` or `end`; then what it meant (the record) fades in.
- **The big news is a sheet**, at most one a game, only for a note in the book: the streak at 7, 30, 100 or 365 days,
  a first ten of ten, a chapter complete. It opens once the result has landed (on the day, once the streak has rolled
  on in its chip too: one moment after another, never one over another), slides up (320ms), opaque,
  over the result dimming behind it (only the dimming fades), its picture landing; its sound plays as it opens;
  „Продължи“, a tap beside it or Esc puts it away, sliding back down (200ms) as the result brightens, never by
  itself. The news's lines under the result stay as they are: the sheet is the note brought forward. A streak's or the
  ten's has its number as the hero (120px, in gold), a chapter's its topic's picture; then „Отбелязано в Алманаха ти.“
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
  `perfect` (ten of ten) with a harmony and a little room; `win` over a low D.
- **Four voices:** a bell (FM) for what's earned; a wooden pluck for the player's own touches; a soft thud for a wrong
  answer or none (never a buzzer); a short beep for the clock. Everything goes through a compressor, so sounds that
  meet can't clip.
- **Short:** an answer's sounds are over in under half a second; a moment's (the end, a note) may take up
  to 1.4 seconds, as it comes once a game.
- **One sound per moment**, and only for game moments:
  - `tap` when an answer is given;
  - `key` for each key of the number pad and each move in an order;
  - `right`, `exact`, `partial`, `wrong` or `time` with the verdict;
  - the clock, only near the end: silent until 10 seconds are left, then a soft `tick` a second, and `hurry` once a
    second for the last five, a step higher each (a question of 10 seconds sounds only those five). „Тиктакане“
    turns it off;
  - `count` for each second of the count before a run, `go` at its start;
  - `end` when a run's result opens (`perfect` for ten of ten), `win` or `lose` at a duel's end;
  - `note` (three bells rising) with a note in the book, as its sheet opens;
  - `ping` when something new waits in Приятели: a friend's request, a friend's duel;
  - `them`, the other side of a duel answering as they did, played second (only while the player hasn't: after, it
    would sound over their verdict): two soft low plucks, A4 then F♯4, off to the right, never a bell;
  - the note's sound only once the result's own has played.
- **Nothing plays** for navigation, hovering or decoration.
- **No music:** people play on the bus or among others.
- **On by default**, with one switch in Профил („Звуци“) that's kept on the device. The audio starts on the
  player's first touch, as browsers require; a sound that isn't allowed yet is skipped, never queued.

## Pictures

The game's illustrations — the avatars, the topics, the ways to play, Рила (for „България“) and
the streak's flame — are drawn by hand as paths in `web/src/art/pictures.ts`, and placed with `picture(id)` from
`art/picture.ts`. They load as a file of their own once the game starts, so the first screen never waits for them.

- **One style:** flat shapes with depth, no outlines, lit from the top left. Depth comes from a lit half and a shaded
  half, a soft shadow set down and right (`lift`), and a light on the top-left edge, never from gradients.
- **One ramp:** a picture is painted from one tone — the topic's, the avatar's, the mode's —
  in its inks: `k0` night ink, `k1` deep, `k2` shade, `k3` the tone, `k4` light, `k5` pale, `kw` white; `ks` a shadow
  and `kh` a light laid over, `kt` a tint of the tone for a ground; `l0`–`l5` the same inks as strokes. `.pic` in
  `app.css` mixes them from `--tone`, so a picture follows its tone and the theme with no colour of its own.
- **On a tile or on a card:** an avatar is painted over a tile in its tone (`k3`), so it uses the darker and lighter
  inks; a topic or a mode stands on a soft disc of its tone (`kt`) over the card, so the tone itself is its main
  colour.
- **Art, not rules:** the pictures are a library the game draws from; the game's rules are `internal/play`'s, and a
  picture never changes them.
- **What there is:** fifteen animals, every one anyone's avatar (лисица, мечка, котка, заек, таралеж, куче, елен,
  щъркел, жаба, мишка, катерица, овца, костенурка, язовец, рис), portraits cut at the tile's bottom; a picture per topic (a bulb, a flask, an amphora, a globe, a clapperboard, a record, a
  ball, a gamepad, a quill in its inkwell, a butterfly), on its tile and, small, on its chips; one per way to play
  (crossed swords, a crown in laurel, an open door) on its card and over its page, and over Приятели (two friends
  side by side, the fox and the bear, heads leaning together: the avatars are the players' faces) and Моят Алманах (a
  book); the streak's flame.
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

- **Look at it** in both themes, at 320px and 390px wide, and at 1024px and 1440px; and on a phone at twice the text
  (Large text). Nothing may scroll sideways, and keyboard focus must show.
- **Run the checks:** `npm run check`, then the browser specs the change touches (`npx playwright test -c e2e
  --project=chromium e2e/<spec>`), and `e2e/a11y.spec.ts`, the accessibility checks.
- **Keep it light:** `go run ./cmd/build` says how big each file is, gzipped. What a change adds should be worth its
  size, but there's no budget to write around: the build fails only past a ceiling far above the game, which only a
  mistake reaches.
