# АЛМАНАХ ⚡ — almanac.bg

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![Лиценз: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Играй](https://img.shields.io/badge/play-almanac.bg-8b5cf6.svg)](https://almanac.bg)

Куиз битки в реално време за много играчи: играй на **[almanac.bg](https://almanac.bg)**. Тук е пълният изходен код
на играта, свободен софтуер под [AGPL-3.0](LICENSE).

![АЛМАНАХ](apps/web/public/og.jpg)

Какво има:

- **Режими:** соло тренировка, въпросите на деня, класирани дуели на рундове с финал с число, отбори 2 на 2, Арена
  за 3 до 5 играчи, Роял за 8 с отпадане и вечерен Роял за до 50, частни и класни стаи с екран за водещия, дуели с
  приятели и линкове с предизвикателство, които всеки може да изиграе.
- **Прогрес:** профилите качват нива, отключват аватари, рамки и титли, печелят постижения, изпълняват дневни
  задачи, трупат дневна серия (с щитове), изкачват се в месечни сезони и пазят подробна статистика.
- **Приятели и общност:** играчите могат да се добавят за приятели, да се канят и предизвикват, да искат реванш и да
  предлагат свои въпроси за одобрение. Посетителите могат да играят веднага като гости и да запазят прогреса си
  по-късно.

## Бърз старт

Нужни са Node 24+ и macOS или Linux (на Windows — WSL: скриптовете са за POSIX shell). Играта ползва вградения
`node:sqlite`, така че няма база данни за инсталиране.

```bash
npm ci
npm run dev
```

Отвори http://localhost:5173, регистрирай профил и играй. При разработка **първият профил, който регистрираш, става
администратор**, за да може да одобрява въпроси от общността. В продукция никой не става администратор с
регистрация; виж стъпка 7 от [Внедряване](docs/self-hosting.md).

Истинската банка с въпроси на играта (над 3000 въпроса) не е част от публичния код, за да не могат отговорите да се
търсят по време на мач. Без нея се играе с примерните 120 въпроса от `apps/server/src/data/questions.sample.json` —
публична извадка от истинската банка, която стига за разработка и за всички тестове. Виж [Въпроси](docs/questions.md).

Когато никой друг не чака за мач, след няколко секунди ботове заемат празните места, така че всеки режим може да се
играе и без други хора. За да тестваш истински мултиплейър локално, отвори втори браузър (или частен прозорец) с друг
профил.

| Скрипт              | Какво прави                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | API + realtime сървър на :3001 и Vite на :5173 (през proxy)                                                           |
| `npm run build`     | Билдва уеб приложението и пакетира сървъра в `apps/server/dist`                                                       |
| `npm start`         | Продукционен сървър на :3001 (чист Node), който сервира и уеб приложението; иска `OPERATOR_NAME` (виж `.env.example`) |
| `npm run typecheck` | Проверява типовете във всички пакети                                                                                  |
| `npm test`          | Всички тестове (около минута), виж [Тестове](docs/testing.md)                                                         |
| `npm run lint`      | Форматиране, правила и подредба на импортите (Biome), както в CI                                                      |
| `npm run format`    | Поправя автоматично каквото може от горното                                                                           |

## Тестове

`npm test` пуска тестовете на сървъра (истински сървър с временна база данни и истински сокети, енджинът на мача с
подменен часовник, наградите, правилата, банката с въпроси, внедряването и връщането назад) и на клиента, и после
проверява как SQLite изпълнява всяка заявка, която сървърът е пуснал. `npm run test:browser` билдва и минава през играта
в истински браузър (Chrome; WebKit и Firefox с `E2E_ENGINES`), с проверка на достъпността (axe) в двете теми. GitHub
Actions пуска всичко това при всеки push към `main` и всеки pull request — браузърните тестове и в трите енджина.
Подробно: [docs/testing.md](docs/testing.md).

## Структура на кода

```
packages/shared   Правила и каталог, общи за клиента и сървъра: режими, крива на нивата, сезони,
                  козметика, козове, постижения, типове за сокетите и REST
apps/server       Express + Socket.IO + SQLite
  src/game/Game.ts        Енджинът на мача, изцяло на сървъра (таймери, точки, отбори, козове, отпадане, ботове)
  src/game/matchmaking.ts Опашки за бърз мач, попълване с ботове и балансиране на отборите
  src/game/rooms.ts       Частни стаи (6-цифрени кодове, линкове /join/123456, отбори, покани към приятели)
  src/game/rewards.ts     Записва мачовете: XP, статистика, сезонно Elo, дневни резултати, постижения
  src/seasons.ts          Месечни сезони: частично нулиране, награди в края на сезона (изчисляват се при нужда)
  src/daily.ts            Въпросите на деня: един набор на ден (от seed), един опит, линкове към деня
  src/skill.ts            Колко труден е всеки въпрос и колко силен всеки играч, мерено по отговорите (като Elo)
  src/runs.ts             Всеки изигран мач въпрос по въпрос (пази се година): за съперници-записи и анализ
  src/game/eveningLobby.ts Вечерният Роял: лобито от 20:55 и мачовете в 21:00
  src/records.ts          Записи на истински Дуели, срещу които се играе, когато няма друг човек
  src/challenges.ts       Линкове с предизвикателство и дуели с приятел
  src/groups.ts           Групи със седмична класация и корона
  src/sets.ts             Наборите с въпроси на учителите и техните картини
  src/almanac.ts, src/mastery.ts  „Моят алманах“, „Поправителен“ и майсторството по категории
  src/push.ts             Известия на устройството (web push)
  src/moderation.ts, src/modlog.ts, src/statements.ts  Модерация, дневникът ѝ и решенията, които играчите получават
  src/friends.ts          Покани за приятелство и кой е онлайн
  src/submissions.ts      Въпроси от общността и модерация
  src/maintenance.ts      Поддръжката на 15 минути: почистване, напомняния, дневните копия на базата
  src/realtime.ts         Сокетите: опашки, стаи, мачове, плавният рестарт и /api/live
  src/data/questions.sample.json  Публична извадка от банката с въпроси (истинската е частна, в private/)
  test/                   Тестовете на сървъра (docs/testing.md)
packages/client   Ядрото на клиента: API заявки, състояние на играта в реално време (zustand), форматиране.
                  Сайтът добавя звуците си; отделено е, за да могат и други клиенти да го ползват
apps/web          React 19 + Vite + Tailwind 4 + Motion
  e2e/                    Браузърните тестове (Playwright)
deploy/           Caddyfile (HTTPS и страницата при обновяване), litestream.yml (бекъпите) и скриптовете на сървъра:
                  deploy.sh, rollback.sh, pull-image.sh, check.sh, backup-check.sh и audit.sh (docs/operations.md)
scripts/          github-setup.sh (настройките на хранилището в GitHub), subset-fonts.mjs (шрифтовете),
                  licenses.mjs (/licenses.txt)
```

## Документация

- [Как се играе](docs/rules.md): режимите, точките, козовете, прогресът и сезоните.
- [Добавяне на въпроси](docs/questions.md): форматът на банката с въпроси.
- [Конфигурация](docs/configuration.md): променливите на средата.
- [Внедряване](docs/self-hosting.md): собствен сървър от нулата — Docker, HTTPS, бекъпи, имейли, известия.
- [Поддръжка](docs/operations.md): обновяване, връщане назад, бекъпи и възстановяване, мониторинг.
- [Тестове](docs/testing.md): какво проверява всеки тест и тестът на натоварване.
- [За поддържащите](docs/maintainers.md): настройките на хранилището в GitHub.
- [История на промените](CHANGELOG.md), [Принос](CONTRIBUTING.md), [Сигурност](SECURITY.md).

## Принос

Issues и pull request-и са добре дошли: виж [CONTRIBUTING.md](CONTRIBUTING.md). Проблеми със сигурността съобщавай
поверително, както е описано в [SECURITY.md](SECURITY.md).

## Лиценз

Кодът е свободен софтуер под **GNU Affero General Public License v3.0 или по-нова версия** ([LICENSE](LICENSE)).
Можеш да го стартираш, изучаваш, променяш и разпространяваш. Ако пуснеш променена версия като публичен уебсайт,
потребителите ѝ трябва да могат да получат изходния ти код: линкът „Изходен код“ във футъра (`SOURCE_URL`) е точно за
това.

Лицензът не обхваща:
- **Името АЛМАНАХ, логото му и домейна almanac.bg.** Копие, което пускаш публично, трябва да има собствено име и
  собствена визуална идентичност (`packages/shared/src/brand.ts`, иконите в `apps/web/public`).
- **Банката с въпроси на играта**, която не е в това хранилище. Примерната банка в него е част от кода и може да се
  използва заедно с него.

Чуждото в хранилището е под собствените си лицензи: шрифтовете Onest и Unbounded — SIL Open Font License
(`apps/web/src/fonts`), а картинките на играта (аватари, категории, козове, постижения) — Fluent Emoji на Microsoft, MIT
(`apps/web/src/emoji/LICENSE`).

## In English

ALMANAC (АЛМАНАХ) is a real-time multiplayer quiz game in Bulgarian, live at [almanac.bg](https://almanac.bg): solo
practice, the questions of the day, ranked duels in rounds with a closest-number final, 2-on-2 teams, arenas of 3–5,
an 8-player battle royale with knockouts, an evening royale for up to 50, private rooms and classrooms with a host
screen, friend duels, groups with weekly boards, and a fact after each answer that players collect.

It's a TypeScript monorepo: an Express + Socket.IO server on Node's built-in SQLite (`apps/server`), a React 19 +
Vite + Tailwind web app (`apps/web`), and the rules and protocol shared by both (`packages/shared`). Every match runs on
the server. Production is a single Docker host behind Caddy, with continuous Litestream backups; CI tests every commit
(server, client, and browser tests in Chrome, WebKit and Firefox) and publishes the image that gets deployed.

Run it with Node 24+: `npm ci && npm run dev`, then open http://localhost:5173. The real question bank is private
(answers shouldn't be searchable mid-match); a public sample of 120 questions ships with the code. The code is free
software under the [AGPL-3.0](LICENSE); the name, logo and domain are not part of the licence. The documentation is in
Bulgarian; issues and pull requests in English are welcome.
