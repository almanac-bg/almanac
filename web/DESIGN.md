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
  in a dashed ring; близо is half filled (a square its upper left half, ◩). Colour is never their only sign. **Dashes
  mean wrong**, and only that.
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

Three places: **Днес** (`/`, and the day's board, `/board`), **Алманах** (`/almanac`), **Приятели** (`/friends`).
Профил and Настройки open from the avatar in the bar (`/me`, `/settings`). Each screen holds its budget, in this order **in the HTML** (a big screen
places it in columns, never with `order`: `contrast.test.ts` forbids it; `e2e/layout.spec.ts` holds Днес's).

- **The frame** (`app.ts`): the bar holds the rosette and „АЛМАНАХ“ in spaced capitals (a way to Днес); on a big
  screen the three places as an icon and a word on pills (`.places`; Днес a calendar, Алманах a book, Приятели two
  people; every name bold); the avatar with the seal the player wears on its corner
  (`.bar-me`), or „Вход“ (the sign-in page, `/signin`). On a phone the places float at the foot (`.places-foot`): a
  pill clear of every edge, its icon over its name, the current one on a well, a dot on Приятели while something has come there since the player last looked (a request, a
  duel sent, a duel's result), gone as it opens. One frame, the same everywhere: the mark is always at the left. It
  steps aside in a game (`html.playing`); on a new visitor's cover and on the sign-in page it is bare (`html.bare`):
  the mark where it always is and no places, „Вход“ at the right on the cover, nothing at the right on the sign-in page.
- **Вход** (`/signin`, `signInPage` in `screens/signin.ts`): under the bare frame, „Назад“ (to the page it was come
  from, else Днес), „Влез в профила си“, and the form, nothing else: the email and „Прати ми код“, then the code
  (`signIn`, the same steps and words as everywhere a code is asked for). Signed in, back to that page (Днес or Профил
  says what came of it). Every way in by name points here: the bar's and the cover's „Вход“, Профил's „Имаш профил?
  Влез“, a player's page's „Влез“. A player signed in already who opens it lands on Профил; Профил with nobody on the
  device is this page. The forms that keep a guest's game with an email stay where they are asked.
- **Днес** (`screens/today.ts`): the issue; its action; the streak.
  - The issue (`.issue`): a stack of ten sheets (`.stack-leaf`) in the colours of its ten chapters, the top one the
    first question's, its corner turned on the second's (`leaf(…, { next })`). On it „Брой N“ on an ink pill, the
    weekday, the date set large with its month, „Десет въпроса за днес“, the ten glyphs (`.issue-toc`), and „Около
    три минути · Днес играха N души“ (the count from 100 players). Left half-way: „Следва въпрос 4 от 10.“ and its
    tiles so far, and „Продължи“; yesterday's left so just before midnight, while the game lets it be finished
    (`play.DayGrace`), comes first, with its date and „Вчерашният брой. Довърши го до 00:15.“ Come by a shared link:
    „Някой позна 7 от 10. А ти?“ and the shared tiles.
  - On a phone the cover is under half the screen (its date sized by the height), so that „Започни“ is whole by 500px
    on 320 × 568 and 540px on 375 × 600 (`layout.spec.ts`). With large text its display type stays near its usual size
    (the date by the height) and „Около три минути“ gives way (`.issue-time`), so the cover never fills the screen.
  - The streak (`.streak-chip`): the flame, the number and „дни в серията“, from three days; under it one line: what
    came of the days just missed (told once), a day the week forgave, or while the day waits what it makes of the
    streak (`stakeLine`). Below three days, what came of the days just missed is that line on its own, in the
    streak's place (`.streak-notice`).
  - On a big screen, under them, „В броя“: the ten chapters in their order.
  - A new visitor: the cover, „Започни“, and under it „Едни и същи за цяла България.“ In an app's own browser, one
    line under „Започни“: on Android „Имаш игра в браузъра? Отвори я там“, a tap that opens it; on an iPhone, where no
    link can, „Имаш игра в браузъра? Отвори я там: ··· → Отвори в Safari“, no button (`coverExit`).
  - Nothing over the issue but what came of the player's own step (a profile signed in to, a game brought here).
    Others' news is Приятели's: its dot for a request, a duel or a duel's result since the last look, its line for a
    friend's yes.
- **The day's result** (Днес once the day is played):
  1. The score on a sheet of the issue's first chapter: „Брой 9 · 20 ноември“, the score as the hero numeral „7 от
     10“, the tiles, „На десетия въпрос вярно отговарят 14 %“ (or „Десетият въпрос е най-трудният днес“ before a
     crowd), and with a crowd „България днес: средно 6,2“ (the average always to one decimal: „6,0“). Ten of ten:
     „Всички верни“ and the mark drawn over it. None right: right under the score, „Въпросите и фактите“ open
     (`.missed-day`): the first four, each its dashed tile, the question, the right answer (an order, a match, a split
     in lines) and its fact, and „Още 6 въпроса“, which shows the rest in place and after them the rest of „Въпросите
     и фактите“; no word of praise. A best rank risen, the big moment, right
     under the score, on its chapter's sheet: „Нов печат“, the seal set large, the rank's name, what made it („40
     факта от Кино и телевизия са с мастило в твоя Алманах.“), the ladder from Бележка to Летопис (`ladder()`), the
     art it brings, and other ranks risen with it in a line.
  2. On the first results (a guest's first day, a game just brought here, an app's own browser): the action, right
     under the score — keeping the game and being reminded, or the way out to the phone's browser (a button: on Android
     it opens the phone's browser, elsewhere it copies the link for it; the app's menu named under it, „Или от менюто
     на приложението: ··· → Отвори в Safari“); sharing then stays a quiet link beside the tiles („Сподели резултата“).
     On a big screen that action heads the right page (moved there, never drawn twice), the two pages of a height.
  3. The day's entry („Днес в Алманаха“, or „Най-рядкото ти попадение“ with a crowd): a sheet of its chapter with the
     chip, the answer as a headword (an order, a match, a split: its parts a line each, at the entry's size), the
     question, the fact. Under it what the day wrote (`game/news.ts`): „+6 с
     мастило“; „Един от въпросите вече беше в твоя Алманах и остава в сиво.“; the chapter nearest its next rank with
     its seal, its name and where it stands (`standing()`: its bar, „Тетрадка“ and „още 2 до „Книга““ under it); or ranks
     risen, their seals and one line, each rank once with its chapters, their names the links („Нови печати: „Страница“ в География и в Технологии и игри.“; one chapter's: its
     ladder under it).
  4. Friends who played it, up to five (`.friends-day`), each a row as on the day's board (`scoreRow()`): their
     place among the player and their friends, the avatar with its seal, the name, and under it „7 от 10“ and their
     small squares. Never a friend who hasn't played, and never before the player has (the squares are the answers).
     „Класация“ at the head's right: the day's board, among friends (`/board`).
  5. The action, past the first results: „Сподели“.
  6. Tomorrow: the next issue's date set big (over its words with large text), „Утре, неделя · Брой 32“ (a line each
     with large text, no dot), the chapter of its hard question with its
     glyph („Трудният въпрос е от История“, once tomorrow is drawn), what it makes of the streak; past the first results, the
     reminder's ask under it while reminders are off, a player with a profile's too (a plain button, never a second
     action; three times at most, once a day). Yesterday's issue finished after midnight has today's in its place
     („Вече излезе.“, „Към днешния брой“).

  Everything else is under „Въпросите и фактите“ (`.more`): how all of България spread („България днес“, at the
  head's right „Класация“, the day's board of all България, `/board?tab=bulgaria`, as „Приятели днес“ has its own;
  „Играха 53 души.“ a line under the head, never beside the link, where a dot would hang at a line's end; the
  average's label in a row over the bars, clear of „ти“ over the player's; the question fewest knew named by its
  number, „най-малко от десетте“, never „най-трудният“, which is the issue's tenth), and each question with its fact
  (its verdict never a true-or-not's answer: „Точно“, „Грешно“).
- **The day's board** (`/board`, `screens/board.ts`), a page of Днес's (Днес marked in the places): the way back to
  Днес, „Класация · Брой 31“, and two tabs, Приятели and България (among friends by default once there are any;
  `?tab=bulgaria` opens on all България, `?tab=friends` among friends). All България: its spread (the player's bar in
  ink) and the player's place first („В България си на 20-о място от 53.“; with none right only „Днес играха 53
  души.“), then the best twenty and the player's own row under them if further down. Among friends: each who played,
  best first; with none, the player's own row and why it's alone (no friends yet: „Добави ги в Приятели“, a link
  there). A row: the place (shared by those as many right and as close on the number, never told apart by time: 1,
  2, 2, 4; the player first among their equals), then the row built as a friend's: the avatar with its seal, the name
  with the row's width and „ти“ after it, and on one line under the name the score (a heavy numeral as a friend's,
  never display-sized) and the small squares after it, under the score only where the line is too narrow (under 360
  px; in large text, as a friend's day, the line runs under the place and the avatar too); the squares once the player
  has played the day, on both tabs. Before that, all България says how many played and that the board comes with the
  player's own result. One reading column on a big screen.
- **Алманах:** its head (Микс and България as two ways to play, words only, no glyph: theirs would sit apart from the chapters'; no lifetime totals), then the chapters, each a folded
  card in its colour with its seal as the badge (40px), its ink („180 с мастило“), its rank over its bar and what's left to
  the next under it („Тетрадка“, the bar, „още 15 до „Книга““: a card has no room for both under the bar); a counter at zero is hidden, and the head says once how ink is written; a
  chapter's card with no ink yet is its glyph over its name, no taller, never stretched to the inked ones beside it.
  Two across on a phone, five on a big screen (the page's whole width, the head a reading width).
  The inked chapters first, led by the one nearest its next step; those with no ink yet after them, from a row of their
  own, so no short card stands beside a tall one. Микс and България are ways to play (`/play/mix`, `/play/bulgaria`),
  never pages of their own: every fact as one list is what the book isn't (DECISIONS.md). A chapter's game left
  half-way today shows under the head, where it stopped, with „Продължи“ (its cross comes back here).
- **A chapter:** its head on its sheet (glyph, name, the seal, its ink, and under them as wide as the head its bar,
  the rank and „още 16 до „Книга““ under it: `standing()`), „Игра на главата“, then its facts, the latest first, each as tall as it holds:
  ink black, facts met in grey (a thin solid 1.5px grey outline, lighter text). An entry reads in the order it was lived:
  the dateline, the question small and muted (a kicker), the answer as the headword (big, bold) between it and the
  fact, then the fact in body text; a statement has no question, its headword right under the dateline; an answer of
  parts a line each. A picture question shows its picture (a choice of pictures, its answer's) beside the question and
  headword, its whole shape (88px wide on a phone, 112px on a big screen), credited in the entry's small text. One
  column on a big screen too, 44rem at most, the head at the left: a book reads top to bottom, the latest first
  exactly, and one column leaves no hole beside a tall entry (two across did; columns or masonry would read down then
  across, and reshuffle as a page comes in). From ten facts, a search over them („Търси факт“); fewer are read at a
  glance. What a search found is marked in each entry (its question, headword and fact) in a soft tone of the
  chapter's colour under the full ink, never split by a soft hyphen. Where grey first shows: „С мастило са фактите от верните ти отговори в броя на деня. Всички други, които срещнеш, са в сиво.“
  Its game's result: on the chapter's sheet its chip, the score and its tiles; under it, with no number (grey is never
  counted), „Фактите от играта са в твоя Алманах, в сиво.“ While the day's issue waits, „Към днешния брой“ is the
  action, the streak's stake under it; once it's played, „Още десет въпроса“ the action. The other ways on are quiet
  links in a line: „Още десет въпроса“, „Прегледай въпросите“, „Към главата“ (from Микс and България, which aren't
  chapters, „Към Алманаха“). On a big screen the result is a spread, as the day's: the sheet on the left page, the
  action, the ways on and that line on the right, „Прегледай въпросите“ under both in a reading column. Its start
  (`/play/<chapter>`) is on the chapter's sheet, its glyph over its name.
- **Приятели:** the people and the duels (the day's board is Днес's); the friends (their heading for a screen reader
  only, right under the page's „Приятели“, „Премахни приятел“ at the right; a row each: avatar with its seal,
  the name across the row, never cut, today's score and the duels between you „дуели 3 : 1“ under it; the column half
  a big screen, the duels the other half; a friend removed only after a sheet asks „Премахваш ли Иво от приятелите си?“, „Премахни“ in red and
  „Отказ“, then at once, the duels open between them ending as if their time were up); the duels (shown once there
  are friends or duels, or the day is played: „Нов дуел“ against a recording needs no friend; „Твой ред“ the page's
  action, „Чакаш“, „Изиграни“: an open one how it stands under the name, „Изиграй същите десет въпроса · още 6 дни“,
  „Довърши своята игра“ once its first question was shown, „Ти: 8 · още 6 дни“; a played one at the right its end
  as a chip, told apart at a glance by fill and line, never red or green („✓ Победа“ filled in ink, „Загуба“ outlined
  and quiet, „Равенство“ outlined in ink), its score beside it, a heavy numeral („8:6“), and on a line of its own
  under the row, the row's width, what more there is to say: that it was against a recording, and what broke a tie on
  even right answers („Равен брой верни · реши по-близкото число“: nothing else does; even in that too, „Равенство“
  and nothing more); one that ran out „Изтече“ alone at
  the right, why under the row („Иво не го изигра навреме.“); the record between two is the friend's
  row's alone). Friends are added in one field, „име или имейл“; a
  friend's yes to a request is one line over the friends, told once; requests sent wait under „Изпратени покани“.
  Only two friends of one name show their @username. A duel's result, as the day's: a white card, the kicker, the
  verdict („Победа“, „Загуба“, „Равенство“) as its h1, the two face to face, each a column (the avatar with its seal, the name under
  it broken only between its words, the score), their scores as the heroes and „от 10“ in words, the marks, no
  hairlines; a spread on a big screen, the ways on (one width) and the record under them on the right (a phone has
  them in that order too: the next duel in sight under the result); its marks as the tiles (близо ◩),
  nothing ringed, no time on any of them: time never counts.
- **Профил:** one column, on a big screen too: the avatar with the seal worn on its corner and „Смени“ under it, the
  name, the @username and by it, on the same line where it fits, the streak as it is now, sized to the head (the
  flame, „58 дни в серията“; never an ended one's, nothing while none runs; no card of its own). What the week
  forgives is no line of the page: the streak's `title`, for a pointer resting on it (that it's used up, only while a
  streak runs); a phone is told it where it matters, when a day missed is forgiven. A guest's ways in one quiet line under it („Играта ти е само на това устройство. Запази я с имейл · Имаш
  профил? Влез“: the first opens its form in the line's place, the second is the sign-in page); „Печати“, one list on a card
  (`sealList()`), a row a chapter with a rank (only those earned), in the bank's order: its seal; its name with its
  ink at the line's end („27 с мастило“, the book's count; under the name where they don't fit); under them where it
  stands (`standing()`); a view of the ranks: nothing to tap, none ringed, no single chapter's ladder (the one worn is
  the best, never chosen: on the avatar's corner); Настройки last. No way to the page as others see it: it is this one
  without what's one's own. No list of past games (a
  game isn't gone over after its day). No duplicate avatar in the bar's corner on this page. The avatars, the fifteen
  animals and nothing else (an avatar is a face: a seal is worn on it, never chosen as it), are a choice made rarely,
  so never on the page: a sheet (`screens/avatar.ts`) opened by the avatar with „Смени“ under it (one button), the one
  worn ringed; a tap wears one and, once it's kept, puts the sheet away. Another player's page (`/players/<tag>`) is
  laid out the same, one column (`profileHead`, `sealsSection`): the same head without a way to change it („Играе от
  …“ in the line under the @username), their streak by the @username as Профил has it (only as it is now: never the
  longest nor an ended one's, nothing while none runs, and not what the week forgives: that's theirs), right under
  the head a card of how you stand (ask to be friends, answer their asking, or friends and „Дуел“), the same seals; nothing of one's own
  (Смени, Настройки). One's own, opened by its @username, is simply the page as others see it, with no card of how
  you stand. Where no email may be asked for (an app's browser that reads what's typed: `noEmail`), Профил and
  Настройки offer none, only the line that says so.

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
  sheet). Avatars and glyphs are rounded tiles, their corners 28% of their size (a card's corner, small); seals are
  round (a seal is round).
- **Space** on a 4px base (`--space-1` … `--space-7`: 4 · 8 · 12 · 16 · 24 · 32 · 48); the page's gutter is 16px on a
  phone, 40px on a big screen; the page is up to 1260px (`/admin` too); a long read in it („Въпросите и фактите“) up to 45rem.
- **Cards** (`.card`, `.rows`) are white surfaces on the page; rows have a hairline between them and are 48px or more.
- **Depth:** the primary action is raised by a 4px shadow below (`--lift`); the answer's panel docked at a phone's
  foot casts a soft shadow up. Nothing else.
- **Touch targets** are at least 44px; anything drawn smaller gets its room around it (`e2e/layout.spec.ts`).
- **Focus:** one rule for everything (`:focus-visible`): a 3px ink outline, 2px off the edge.

## The pieces

- **The sheet** (`leaf()` in `ui.ts`, `.leaf`): a chapter's colour (`--ts`), the dark ink on it, round corners. With
  `{ next }` its corner is turned (`.folded`, `.fold`): the back of the sheet lighter, a fine shade on its edge, and
  under it the next sheet's colour (`.leaf-next`) — the issue's cover and the chapter cards only.
- **The glyph** (`glyph()`): a chapter's art on a white rounded tile, without the art's round ground (the tile is its
  ground; the seal's core keeps it). **The chip** (`chip()`): the glyph and the chapter's name on a white pill.
  Wherever a chapter's colour is, its glyph is.
- **The tiles** (`tiles()`): the day's ten in their chapters' colours, a glyph on each. Right: filled, the glyph on a
  white rounded tile. Близо: the upper left half in the chapter's colour, cut on the diagonal (◩, never the left half,
  which reads too near a full one), the lower right hollow, the glyph straight over both, a 2.5px outline in the deep
  colour. Wrong: hollow, a dashed outline, the glyph faded. A void one dashed and empty; one to come a quiet well. They
  read at 28px. **The small squares** (`mini()`, 10px): a friend's or a board's row, in ink: full, the diagonal half,
  empty; told apart by fill, never by colour, and nothing drawn inside them (unreadable at 10px). A day has one close
  answer at most (the hard number), so one ◩ at most.
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
  rank is said and drawn by one component, `standing()`, everywhere (Профил's seals, a chapter's page and card, the
  result's line): a bar filled for the chapter's ink out of the next rank's (1 of 5 a fifth, 40 of 100 two fifths: its
  length says how near the next is in the words' own units, and a first ink shows), past Летопис the ink within its
  hundred (`from`, `nextAt`: play.ChapterRank), never full while the next isn't held; under it its two ends named:
  at the left the rank held, bold, in ink („Страница“, „Летопис · 2“; before a first seal „Още без печат“), at the
  right what's left to the next („още 8 до „Тетрадка““, breaking only between „още 8“ and „до „Тетрадка““). On a
  card, too narrow for both, the rank over the bar and the right one alone under it. With large text the right goes
  under the left, never cut. On the page the bar is the chapter's deep colour over a track of it; on a chapter's
  sheet the sheet's ink (`standing.test.ts` holds both 3:1, day and night). The seal itself never shows it. By day a fine
  outline in the deep colour; on a sheet (its own colour, often) a 2px ink rim (`.rimmed`), and a filled seal there a
  lighter disc of its colour, so Бележка, a thin open ring, shows the sheet through it and Страница doesn't. With a
  player only the seal shows, never its rank's word, and only in one place: on their avatar's lower right corner
  (`avatar(id, { seal })`), 45% of the avatar (14px at the least), on a ring of what's around it (the page, or a card's
  surface: `--ring`), wherever the player shows (the bar, the boards, friends, requests, duels, Профил),
  never after the name. The word is the Алманах's and a rank-up's. The seal worn is the player's best, never chosen
  (play.sealOf). A seal's reward is the seal itself: it unlocks nothing.
- **The ladder** (`ladder()`, `.ladder`): a chapter's six ranks in a row, each its seal and name; the one reached ringed
  in ink, its name heavy; those to come faded (with large text, two rows of three). On a rank-up. Six equal
  columns, the reached seal's ring inside its own; sized by the ladder's own width (a container query), so that under
  24rem only the reached one is named, over its neighbours' room (from the ladder's edge at a row's end); every seal
  stays.
- **Buttons:** `.btn` (outlined in `--line-2`), `.btn.primary` (the one action), `.btn.danger`, `.link` (`.tap` for a
  finger's height). Fields (`input`) are white boxes with a 2px `--line-2` frame, a button's height. `.segmented`: tabs
  or a setting's few choices on a well, the chosen one a raised surface, of one width unless a word needs more (never broken inside one). A switch is a 52 × 30 track. Never a native
  select, radio or checkbox.
- **Sheets over the page** (`.sheet`, a `<dialog>`): a surface with round top corners over a scrim, from the foot on a
  phone, centred on a big screen (a name asked for, the share, a way out of a game, the avatars); its title's words whole,
  „Затвори“ under it where they don't fit beside it.
- **Names** (`nameWords()`): a name breaks between its words first; a single word wider than its line, and only
  then, at its syllables with a hyphen. „ти“ stays on its last word's line, never alone. Never cut
  with an ellipsis. Outside the play screen a fact or an entry holds its words the same way (`textWords()`), and an
  email address breaks after its @ or before a dot (`emailWords()`). A chart's axis labels never wrap („10“). A name
  in Latin letters breaks at its syllables too („Maximi-lian“). A name that links to its player is never underlined
  at rest (its row or place says whose it is), and under a pointer underlined whole.
- **What a tap brings up** under it (an ask, an answer: „Нова връзка“, „Добави“, „Изтрий профила“) is scrolled into
  sight whole, clear of a phone's places at the foot (`inSight()`).
- **Rows of players:** `who()` (the avatar with its seal, and the name), `playerRow()` (a friend's
  `.friend` and a board's `.rank-row`, one build: Приятели, the day's board, and Днес's friends), `.duel-row`. **Avatars** (`avatar()`): the drawn animal
  on a rounded tile of its scene, the seal worn on its corner. Only the fifteen animals: an avatar is a face.
- **What went wrong** is never a dead end: `failure()` says what happened, offers „Опитай пак“ where it can help, and
  always a way on.

## Play

A run (`game/run.ts`) on a phone is a column the screen's height: the head, the pips and the clock at the top (kept in
sight as the page scrolls, smaller once stuck), the question's sheet under them, what answers it at the foot under the
thumb. On a laptop (64rem) it's a spread the page's width (1180px): the head and the sheet (and its picture) on the
left; what answers it on the right, level with the sheet, and the answer right under it, the page moving just enough
to show it whole; nothing over the question.

- **The head** (`.question-head`): the cross out („Към Днес“; from a chapter's game „Към Алманаха“), what's played („Брой 31“, the chapter, „Дуел с Мария“
  over it), and the number big: „4/10“ to the eye, „4 от 10“ aloud. Nothing counts right answers in a row.
- **The clock** (`.timer`): a bar under the pips, the seconds at its end; ink and heavier for the last ten seconds;
  gone once answered. Its sound: silent until ten seconds are left.
- **The sheet** (`.q-leaf`, no corner): the chip (and on the day's last question „Най-трудният: число“ beside it), then the
  question. Under 700px of height the sheet is the question with the chapter's glyph beside it (on the day's last, its
  tag; under 620px the chip's glyph alone beside it), so that a picture, a pad or rows fit under it; under 620px an
  answer is 52px. Under 680px, while an order or pairs are asked, the question is a size smaller, the rows right under
  it (not at the foot), and the rows and cells are 44px; from 375px across at the usual text it's cut to as many lines
  as leave every row and „Готово“ on the screen (two at the least), at a whole word with „…“, the same in every engine
  (a tap on it reads it all: answering.ts, `clamp`); where the page scrolls anyway (320px, large text) it's whole; the pairs' right
  column, a cell more, has five ninths of the width. A picture over the question
  takes at most 30% of the height, and shrinks where the screen is short, never under 120px. A choice of pictures is
  two by two, each picture whole and centred in its card, the letter and
  (answered) the ✓ or ✕ in the picture's corners, its name under it across the card once answered (no room kept for
  it before).
- **What fits** (21 Nov: the fit machinery kept trading one defect for another): from 375 × 600 up, a question and what answers it fit without scrolling.
  On a 320 × 568 phone and with twice the text the page may scroll, but nothing is shrunk into uselessness, cut
  mid-element or covered: what answers it starts in sight, a picture is never under 120px, a cut question ends at a
  whole word, the page moved for an answer lands on whole edges, and the answer's panel comes under the answers,
  never over them. „Отговори“ and „Готово“ are in the page's flow, never over what they'd cover. Prefer removing fit logic
  to adding more.
- **A cell's words** (`wholeWords()`): a long word breaks only at its syllables (soft hyphens, `lib/words.ts`) and only
  where it's wider than its cell; a punctuation mark stays with its word. Never `break-all`.
- **Answers** (`.option`): white, a 2px `--line-2` frame, the letter in a box (А–Г, keys 1–4 on a computer); a
  choice's words have the row's width while it's asked.
- **Answered:** the player's own right answer is ink — a dark fill with white text by day, a light fill with dark
  text by night — and a solid ✓; the right one they didn't give has a 3px ink outline and a ✓ in a ring; their wrong
  one is hollow and dashed with a ✕ in a dashed ring and „ти“. The rest shrink to their own words, a size smaller (from
  2.25rem, wrapping, never cut with „…“), so
  that the player's row and the right row are right under the question; the page moves once, as little as it can
  (the answer, below), and moved, the head's foot falls between two parts, never across one: no scrap of the sheet,
  a clue or a row left under it. On a
  laptop the sheet stays whole under the head however far the page moves. The crowd's shares fill in
  behind each answer. After a choice's words, in this order: „ти“, the share, the ✓ or ✕, in one box (`.row-end`) on a
  line with them, or together on the line under them, at the row's end, where they'd squeeze the words (with large
  text, in the row's foot). An order's value and its ✓ or ✕ are such a box too, never broken.
- **Each kind:** true-or-not, two side by side, answered with the ✓ or ✕ beside the word and „ти“ under the player's
  wrong one; order, rows of 48px picked up and put down or dragged by their grip, answered as the right order — a row
  in place with a solid ✓, one out of place hollow and dashed with „при теб: 3-то“ under its words, its value and ✕
  at its end; match, two columns from their tops, the left lettered А–Г and a right one joined taking its left one's
  letter (never colour), each letter on its cell's edge where the line joins it (with few words to a line, one column
  over the other, the letters beside the words, no lines); split, a card sent left or right, each group's arrow beside
  its name; clues, coming out as their time does, those still to come in one line („Още 2 подсказки: след 10 с и
  20 с“); number, typed on the game's own pad (keys
  44px at the least; with large text what's typed stays in sight under the head), answered as what was said, the
  answer (not again where it was spot on), and both on a scale with its key (the answer a filled square; „ти,
  вярно“ a filled disc, „ти, близо“ half filled, „ти“ hollow), nothing else (how everyone guessed is said under the verdict; its chart is the review's). Pairs or groups
  whose time ran out with nothing given show the right ones with a ✓ in a ring: none of it the player's.
- **The answer** (`.after`): under the answers, never over them; on a phone at the screen's foot, edge to edge, a
  surface. The page moves once (run.ts, `settle`), as little as it can: to show the verdict over „Напред“ (under an
  order's rows, and with large text, the fact's first line too, whole, or where the verdict leaves it no room the fact
  whole under „Напред“, a scroll away), and the fact's first two lines where that leaves the player's row and the
  right one (an order's rows) clear of the head. Where the panel goes on past the screen's foot, „Напред“ stays there on a foot of the panel's colour down
  to its edge (`.after-foot`), what goes on under it fading out over it: nothing shows under it. In it, the verdict,
  a choice
  missed its right answer in words („Вярно е: Съединението.“; not a choice of pictures, each named under it, nor
  where the question names it), how many got it, „Записано с мастило · глава История“
  for ink, on a question of the date „На този ден“ and what happened that day, „Знаеше ли?“ and the fact, a picture's credits (a choice of pictures' too, here where nothing covers
  them), and „Напред“ (the one action).
- **Verdicts** are a fixed set, never an answer's own word: „Точно!“, „Вярно!“ (a number near enough to count, not
  spot on), „Не е това.“, „Близо, но не се брои.“, „Времето изтече.“ The verdict's sign is ink: a filled disc with ✓, a half-filled disc, a ✕ or a clock in a dashed
  ring.
- **Leaving** while a question's time runs asks in a sheet at the foot („Остани“, „Излез“).

## Fit and large text

- **Fit** (`e2e/layout.spec.ts`, at 320 × 568, 375 × 600, 390 × 664 and 1366 × 900, by day and by night; every kind of
  question at its longest in the sample bank, and beside them the real bank's longest orders, pairs, choices, clues,
  numbers and groups and its longest choice under a portrait where it's here (`private/`; CI has only the sample),
  answered right, wrong and close: `e2e/kinds.ts`, `e2e/bank.ts`): nothing scrolls sideways; Днес shows „Започни“
  whole and high; from 375 × 600 a question shows every answer or its pad and its action
  whole; at 320 × 568 every control is a scroll away, under nothing, the first answer in sight; a picture never under
  120px; once answered, the player's row, the right one, the verdict and „Напред“ are in sight, nothing under „Напред“,
  nothing under the panel nor a scrap under the head, the panel packed; a row's sign never on a line of its own, nor a punctuation mark.
- **Large text:** the text grows with the browser's setting and with „Размер на текста“ (up to twice). Everything is
  in rem from `<html>`; display type grows at half the rate (half px, half rem) and a big numeral is capped by the
  screen's width or height. One-column grids are `minmax(0, 1fr)`; a row of things wraps. `lib/prefs.ts` puts `tight`
  and `tighter` on `<html>` when the column holds few words, and rows give way to columns there. With `tighter`, an
  order's or pairs' line on how to answer is read, not shown (the first rows show over „Готово“). With `tight`, Днес's
  cover leaves out its row of glyphs, and the places' bar at a phone's foot grows at most a quarter, so „Започни“
  stays over it. A media query's rem
  is the browser's own size, so a short screen is a phone on its side only with `(orientation: landscape)` too.
  `e2e/layout.spec.ts` holds it at every size above.

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

Every picture is drawn to one sheet, so that none stands out as another hand's:

- **An avatar is a bust, front on**, on a rounded tile of its scene (the picture 88% of the tile, set in 6%; the tile's
  corners 28% of it; the body runs past its foot). Its skull, without ears, wool or quills, is 34–38 wide about x = 32, its eyes at y 32–36 and 7–9
  from the middle; ears, antlers and tufts start inside the skull, so nothing floats. Its body is the same shoulders
  for all, in its darkest fur; what stands in for them keeps their place (the turtle's shell, the sheep's wool, the
  stork's breast). Only what the animal is changes this: the stork is in profile, the frog's eyes are on top.
- **One eye:** a night-ink circle (radius 2.3–2.8) with a white glint up and to its left, on both eyes alike; the cat
  and the lynx have it on an iris. No lids, brows or whites.
- **One light**, from the top left: a crescent of light inside the head's upper left edge, the head's shadow on the
  chest under the chin, the glint. A white animal takes a crescent of shade down its right instead.
- **Filled shapes, never outlines.** A stroke is only what is a line in life (a whisker, a mouth, an antler, a seam),
  round-ended, 1.2 wide or more. Symmetric parts are drawn once and mirrored; only the light is one-sided.
- **Colours by name:** an animal's furs and pale parts are its inks (`k1`, `k2`, `k4`, `k5`), its own accents `ka` and
  `kb` (an iris, a beak), all set under `.tone-natural.sh-<shape>`; never by a part's place among the layers
  (`pictures.test.ts`).
- **At 32px** (a friend's row; a grid unit is under half a pixel) an avatar is its silhouette (ears, antlers, a tail,
  a beak, each 6 or more wide where it starts), two eyes and one pale muzzle or mask. Finer detail may fade there, but
  not break into specks; fur and tile differ in hue and in lightness.
- **Each animal its own tile colour** (`--tone` under `.tone-natural.sh-<shape>`), none repeated (`pictures.test.ts`):
  fifteen soft tones round the wheel, of a lightness and strength that sit together, each chosen against its animal's
  main colour (the orange fox on sky blue, the green frog on orchid, the black-and-white badger on amber), never a near
  match; the same by day and by night.
- **A glyph** is one object, upright, within the ground (30 from the middle), in the chapter's tone with its dark and
  white, never pale on pale; a highlight up left, a shade down right.

Look at all of them together after changing one: 200, 64, 40 and 32px, by day and by night.

## The share

- **The text:** „Брой 42 · 8/10 · серия 23 дни“ (the streak from three days), the squares ■ right, ◩ близо (U+25E9, the upper left half, as the tiles), □ not, and the
  link whole, „https://almanac.bg/d/…“, so that every messenger links it (`game/share.ts`). Unsigned.
- **The card** (`internal/card`, `/card/<issue>-<shape>.png`), drawn once, by the server, one look in every theme: the
  picture a shared link's preview shows, and the one the sheet shows and shares. The mark and the name, „Брой N“ big
  with its date, the ten tiles two rows of five (filled with the glyph on a white tile, the upper left half, dashed and hollow: they part in
  grey too), and
  almanac.bg. No score, no streak, no name. In the same look the site's own picture (`/og.png`): the mark and the name,
  „Десет въпроса на ден, едни и същи за цяла България.“, a day's ten tiles and almanac.bg.
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
- **A chapter's name is in quotes only right after the word „глава“:** „в глава „История““, „Носиш печата на глава
  „Наука““. Standing alone it's bare: „Трудният въпрос е от История“, „Печат: История“, „Печатът на История“
  (`language.test.ts`).
- **Copy promises nothing the game doesn't do:** ink is „вярно отговорени“ in the issue, never „знаеш“; a counter at
  zero is hidden; an ended streak's number is never named.
- **„със“ before с and з** („със Стефан Баторий“, „със 7“), „с“ before the rest; before a name, a number or anything
  that comes in, through `withWord()` (the server's `withWord` in words.go): `language.test.ts`.
- **Numbers the Bulgarian way** (`formatNumber()`): a space between thousands from 10 000; a decimal comma; „38 %“
  with a no-break space; the minus „−“; a unit after a no-break space; months in lower case. A number and the word it
  goes with („7 от 10“, „3 дни“) never part at a line's end.
- **No emoji in the interface.**

## In code

- `ui.ts`: `leaf`, `glyph`, `chip`, `tiles`, `mini`, `seal`, `standing`, `sealList`, `ladder`, `avatar`, `who`, `verdict`,
  `fact`, `filed`, `segmented`, `failure`, `rosette`, `back`, `nameWords`, `textWords`, `emailWords`, `inSight`.
- `game/run.ts`: `trail`, `questionHead`, `timer`, `settle`; `game/questions.ts` each kind; `game/news.ts` what a game
  wrote; `game/share.ts` the share.
- **Selectors:** a part has its own class (`.status-n`), not a tag under a class; Biome flags the other kind. A class
  nothing names any more goes, with its rules.
- **Test hooks** the browser tests depend on: `.question-head`, `.options .option`, `.keypad`, `.sortable-list`,
  `.verdict`, `.right-said`, `.after`, `.up-next-go`; `.issue`, `.issue-go`, `.today-side`, `.result`, `.result-main`, `.score-n`,
  `.tiles .tile`, `.tomorrow`, `.result-share`, `.share-sheet`, `.streak-chip`, `.streak-notice`, `.day-entry`, `.friends-day`, `.missed-day`;
  `.summary`, `.reviewed`, `.news-facts`; `.toc-row`, `.entry`; `.day-board`, `.rank-row`, `.friend`, `.invitation`,
  `.accepted-notice`, `.duels`, `.duel-turn`, `.duel-row`, `.their-line`; `.me-ladder`, `.ladder`.

## Before a UI change ships

- **Look at it** on a seeded database (CLAUDE.md) as its personas, by day and by night, at 320, 375 × 600 and 390 ×
  664 and at 1366px, and at twice the text.
- **Run the checks:** `npm run check && npm test` (with `contrast.test.ts`), then the browser specs the change touches
  in Chromium, `e2e/layout.spec.ts` and `e2e/a11y.spec.ts` among them.
- **Keep it light:** `go run ./cmd/build` holds the first screen to its budget.
