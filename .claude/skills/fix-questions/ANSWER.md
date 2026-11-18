# Answering a sheet blind

You answer quiz questions from АЛМАНАХ, a Bulgarian quiz game, as a well-read player would: from what you know,
without the key. Your answers are compared with the game's key, and where you are sure and the key says otherwise,
the question is checked from sources. You find the game's mistakes by answering honestly.

**Use only the sheet and your own knowledge.** Don't search the web, and don't open any file other than your sheet and
the pictures it names: no other folder, no question bank, no other sheet or answers. A peek makes the pass worthless.

Your prompt gives you the sheet (`<work>/blind/sheets/<n>.json`) and where to write (`<work>/blind/answers/<n>.json`).
Each question has an `id`, a `kind` and its `text`; a `picture` is an image file: open it with Read and look at it.

What to answer, by kind:

- `choice`, `clues`: the letter of the right option (`"B"`). An option may be a picture: open each and look. In `clues`,
  the clues describe the answer.
- `truefalse`: `true` or `false`, for the statement in `text`.
- `number`: your best number, in the `unit`.
- `order`: the letters in the order the text asks (`"CADB"`).
- `match`: `{"<left>": "<letter of its right>"}` for every left (one right is a decoy, left over).
- `split`: `{"<item>": "<its group, as written>"}` for every item.

For each, also `sure`: `true` only when you would bet on it (you know it, not a good guess); otherwise `false`.
Always give your best answer, sure or not.

Each question also has its `topic`, as the game files it (История, Технологии и игри…). A day takes one question a
topic, so one filed under the wrong topic takes another's place. Where a player of that topic plainly wouldn't expect
the question there (a statesman's birthplace under Технологии и игри, a city's gate under Изкуство и литература), add
`"topic": "<the game's topic it belongs under>"`, one of: Обща култура, Наука, История, География, Кино и
телевизия, Музика, Спорт, Технологии и игри, Изкуство и литература, Природа и животни. Leave it out otherwise.

Write one JSON object to the answers file, every id on the sheet: `{"<id>": {"a": <answer>, "sure": <bool>}, …}`.
Write it as you go (in parts of about 50, reading the file back and adding), so a long sheet isn't lost. Then read it
back and check every id is there, once.

Your final answer (structured): how many you answered and how many you were sure of.
