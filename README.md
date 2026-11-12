# АЛМАНАХ — almanac.bg

Въпроси, от които научаваш нещо. Десет на ден, едни и същи за всички; игра по теми, която следва колко знаеш;
предизвикателства към приятели и стаи за игра заедно. Играй на **[almanac.bg](https://almanac.bg)**.

Свободен софтуер под [AGPL-3.0](LICENSE).

## Как е направена

Една програма на Go и уеб клиент на чист TypeScript и CSS, без рамки.

- **Сървърът** (`cmd/almanac`, `internal/`) е един статичен файл: HTTP, HTTPS, базата данни (SQLite), пощата и
  клиентът са вътре. Зависи само от драйвера за SQLite.
- **Клиентът** (`web/`) е под 10 kB (gzip) и се строи с esbuild през `go run ./cmd/build`. Бюджетът му е в CI.
- **Въпросите** (`internal/bank`) са сърцето на играта: всеки вид въпрос (с избор, с число, за подреждане) сам се
  проверява, раздава и оценява. Нов вид е нов файл тук и неговият изглед в клиента.

```
cmd/almanac      програмата: serve, bank check, bank fmt
cmd/build        строи клиента в internal/assets/dist
internal/bank    въпросите: видовете, банката на диска, проверките
internal/store   SQLite и миграциите (internal/store/migrations)
internal/account гости, вход с код по имейл, сесии, имена
internal/mail    пощата: опашка в базата, SMTP
internal/server  HTTP: API, страницата на приложението, файловете
web/src          клиентът: lib/ (DOM, сигнали, рутер), screens/
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
npm ci && npx tsc -p web && npx biome ci . && npm test
go run ./cmd/almanac bank check      # банката: private/, ако я има, иначе bank/sample
```

Истинската банка е в частното хранилище `almanac-bg/almanac-questions`, клонирано в `private/`. Без нея играта
върви с извадката в `bank/sample`.

## Лиценз

Кодът е под **GNU Affero General Public License v3.0 или по-нова** ([LICENSE](LICENSE)), с допълнително разрешение
за магазините за приложения ([APP-STORE-EXCEPTION.md](APP-STORE-EXCEPTION.md)). Лицензът не обхваща името АЛМАНАХ,
логото и домейна almanac.bg, нито частната банка с въпроси. Снимките във въпросите са под собствените си свободни
лицензи, посочени при всяка.

## In English

ALMANAC (АЛМАНАХ) is a Bulgarian quiz game at [almanac.bg](https://almanac.bg): ten questions a day, the same for
everyone; topic play that follows what you know; challenges and rooms to play with friends. One Go program (stdlib +
SQLite) serves a plain TypeScript client of under 10 kB. Run it with `go run ./cmd/build && DEV=1 go run
./cmd/almanac serve`. Free software under the AGPL-3.0; issues and pull requests in English are welcome.
