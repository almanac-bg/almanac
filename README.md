# АЛМАНАХ — almanac.bg

Въпроси, от които научаваш нещо. Десет на ден, едни и същи за всички; игра по теми, която следва колко знаеш;
дуели и стаи за игра заедно, на живо; предизвикателства към приятели. Играй на **[almanac.bg](https://almanac.bg)**.

Свободен софтуер под [AGPL-3.0](LICENSE).

## Как е направена

Една програма на Go и уеб клиент на чист TypeScript и CSS, без рамки.

- **Сървърът** (`cmd/almanac`, `internal/`) е един статичен файл: HTTP, HTTPS, базата данни (SQLite), пощата и
  клиентът са вътре. Зависи само от драйвера за SQLite.
- **Клиентът** (`web/`) е около 15 kB скрипт и 6 kB стилове (gzip) и се строи с esbuild през `go run ./cmd/build`.
  Бюджетите му (30 kB и 10 kB) са в CI, както и играта, изиграна в Chromium, WebKit и Firefox (`e2e/`). Шрифтовете
  (Sofia Sans и Literata) са наши файлове: браузърът не пита никой друг за нищо.
- **Въпросите** (`internal/bank`) са сърцето на играта: всеки вид въпрос (с избор, с число, за подреждане) сам се
  проверява, раздава и оценява. Нов вид е нов файл тук и неговият изглед в клиента.

```
cmd/almanac      програмата: serve, bank check/fmt, backup now/restore
cmd/build        строи клиента в internal/assets/dist
internal/bank    въпросите: видовете, банката на диска, проверките
internal/store   SQLite и миграциите (internal/store/migrations)
internal/account гости, вход с код по имейл, сесии, имена
internal/mail    пощата: опашка в базата, SMTP
internal/play    играта: денят, темите, предизвикателствата, дуелите, класацията, серията, статистиката
internal/room    игра на живо: стаите и дуелите (Server-Sent Events)
internal/push    известията (Web Push)
internal/backup  копията на базата в R2
internal/server  HTTP: API, страницата на приложението, файловете
deploy           услугата и скриптовете на сървъра
web/src          клиентът: lib/ (DOM, сигнали, рутер), game/ (въпросите, играта), screens/, ui.ts, fonts/
web/DESIGN.md    дизайнът: правилата (стойностите са в web/src/app.css)
e2e              играта в истински браузъри (Playwright)
bank/sample      публична извадка от въпросите (истинските са частни)
```

## Разработка

Нужни са Go и (само за проверките на клиента) Node 24.

```bash
go run ./cmd/build -watch            # клиентът, при всяка промяна
DEV=1 go run ./cmd/almanac serve     # http://localhost:8080 — пощата отива в лога
```

Проверки, както в CI:

```bash
go vet ./... && go test -race ./...
npm ci && npm run check && npm test
npm run e2e                          # играта в Chromium, WebKit и Firefox (BROWSER_PATH: свой Chromium)
go run ./cmd/almanac bank check      # банката: private/, ако я има, иначе bank/sample
```

Истинската банка е в частното хранилище `almanac-bg/almanac-questions`, клонирано в `private/`. Без нея играта
върви с извадката в `bank/sample`.

## Сървърът

Един сървър (Hetzner), зад Cloudflare. Програмата работи като systemd услуга (`deploy/almanac.service`) и сама
говори HTTPS със сертификата на Cloudflare за сървъра. Всеки час копира базата си в Cloudflare R2.

- Ново издание: `git tag vX.Y.Z && git push origin vX.Y.Z` — GitHub строи програмата и пуска изданието.
- На сървъра: `almanac-deploy vX.Y.Z` го слага; ако не тръгне до 30 секунди, връща предишното. Същата команда с
  по-стара версия връща назад.
- Нови въпроси: `almanac-bank` — дърпа банката, проверява я и я презарежда без рестарт.
- Възстановяване: `almanac backup restore days/12.db.gz /var/lib/almanac/restored.db`, после смяна на файла при
  спряна услуга.
- Нов сървър: `deploy/setup.sh`, настройките по `deploy/env.example`, после `almanac-deploy`.

## Лиценз

Кодът е под **GNU Affero General Public License v3.0 или по-нова** ([LICENSE](LICENSE)). Лицензът не обхваща името
АЛМАНАХ, логото и домейна almanac.bg, нито частната банка с въпроси. Снимките във въпросите са под собствените си
свободни лицензи, посочени при всяка. Шрифтовете Sofia Sans и Literata са под SIL Open Font License 1.1
([web/src/fonts/OFL.txt](web/src/fonts/OFL.txt)).

## In English

ALMANAC (АЛМАНАХ) is a Bulgarian quiz game at [almanac.bg](https://almanac.bg): ten questions a day, the same for
everyone; topic play that follows what you know; live duels and rooms; challenges to friends. One Go program (stdlib +
SQLite) serves a plain TypeScript client of about 15 kB. Run it with `go run ./cmd/build && DEV=1 go run
./cmd/almanac serve`. Free software under the AGPL-3.0; issues and pull requests in English are welcome.
