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
- **Game feel comes only from data the game has** (see Game feel below). No currencies, XP, shops or made-up
  numbers.
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
  - `rose`: duels and challenges.
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
  - `.btn`, with `primary`, `big`, `danger` and `inline`; and `.link`.
  - `.field` and `input.code`; `.join` for an input with its button.
  - `.tag` and `.chip`.
- **Numbers:** `.figures`/`.figure`, `.stats`/`.stat`, `.streak` (with `.week`), `.rings`/`.ring`, `.games`/`.game`.
- **Play:**
  - `.question-head` (with `.count`), `.trail`, `.timer` and `.ask`.
  - `.options .option`, with the states `picked`, `placed`, `right`, `wrong` and `dim`.
  - `.verdict` and `.fact`.
- **Results:** `.summary`, `.board`/`.row` (with `p1`–`p3`, `me`, `gap` and `moves`), `.topics`/`.topic`,
  `.players` and `.settings`.
- **In code:**
  - `ui.ts` has `verdict`, `fact`, `streak`, `stat`, `figure`, `ring`, `level`, `levelBadge`, `meter` and
    `toneOf`.
  - `game/run.ts` has `trail`, `questionHead` and `timer`.
  - `game/results.ts` has `summary`, `board`, `boardRow` and `shareButton`.
- **Selectors:** give a part its own class (`.streak-num`) rather than a tag under a class (`.streak b`). Biome's
  `noDescendingSpecificity` flags the second kind.
- **Test hooks:** the browser tests depend on these classes; keep them:
  - `.question-head`, `.options .option`, `.number` and `.number-input`
  - `.after .next`, `.summary`, `.reviewed` and `.verdict`
  - `.players li` and `.challenge-link`

## Game feel

Every element that looks like a game measures something the game already counts:

| Element     | Measures                                                                                                                     | Where                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Streak      | Days in a row with the day's ten; the strip is this week's days played (`week` in `/api/day` and `/api/me/stats`)            | Днес, Профил            |
| Points      | Points per answer and per run, from the server                                                                               | Verdict, result, boards |
| Place       | Place on the day's board („12-и от 318 днес.“)                                                                               | Result, Профил          |
| Mastery     | Share right in a topic, shown after 10 answers: Новак (under 40%), Любител (40–59%), Познавач (60–79%), Майстор (80% and up) | Игра, Профил            |
| Rank change | Places moved since the previous answer                                                                                       | Room boards             |
| Duels       | Duels won of played                                                                                                          | Заедно, Профил          |

Feedback fires once, when it's earned, and then the screen is still again:

- A right answer pops and glows.
- Points rise in gold.
- An exact number answer gets the star.
- A wrong answer shakes once.

## Copy

- **Language:** Bulgarian, to one player with „ти“, in short plain sentences. Text must be gender-neutral.
- **Buttons** are verbs: „Започни“, „Напред“, „Още десет“.
- **Verdicts** are a fixed set: „Точно!“, „Вярно!“, „Близо.“, „Не е това.“ and „Времето изтече.“
- **Numbers the Bulgarian way:**
  - a space between thousands from 10 000 up („1380“, „12 500“);
  - a decimal comma;
  - a unit after a space („15 с“);
  - places as „12-и“.
- **No emoji in the interface.** A shared result keeps its squares (🟩🟨⬛), because that text leaves the app.

## Motion

- **Timings:**
  - presses 120ms; hover and colour 160–200ms;
  - the right answer's pop 360ms; the wrong answer's shake 320ms;
  - the points' rise 520ms;
  - the timer runs linearly with the clock.
- **No ambient motion** and no confetti.
- **Reduced motion:** under `prefers-reduced-motion` the pop, the shake, the rise and the transitions stop. The timer
  still moves, because it is information.

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
- **Keep to the budgets:** 10 kB of CSS and 30 kB of JS, gzipped. `go run ./cmd/build` fails over them.
