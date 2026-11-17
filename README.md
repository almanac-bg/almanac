# АЛМАНАХ — almanac.bg

Въпроси, от които научаваш нещо. Десет на ден, едни и същи за всички; игра по теми, която следва колко знаеш;
дуели на живо и приятели, които се предизвикват; Роял на живо в 21:00; стаи за игра заедно. Играй на
**[almanac.bg](https://almanac.bg)**.

Свободен софтуер под [AGPL-3.0](LICENSE).

## Как е направена

Една програма на Go и уеб клиент на чист TypeScript и CSS, без рамки.

- **Сървърът** (`cmd/almanac`, `internal/`) е един статичен файл: HTTP, HTTPS, базата данни (SQLite), пощата и
  клиентът са вътре. Зависи само от драйвера за SQLite и от age, с който се шифроват резервните копия.
- **Клиентът** (`web/`) е около 23 kB скрипт и 10 kB стилове (gzip) и се строи с esbuild през `go run ./cmd/build`.
  Бюджетите му (40 kB и 14 kB) са в CI, както и играта, изиграна в Chromium, WebKit и Firefox (`e2e/`). Шрифтовете
  (Sofia Sans и Literata) са наши файлове: браузърът не пита никой друг за нищо.
- **Въпросите** (`internal/bank`) са сърцето на играта: всеки вид въпрос (с избор, с число, за подреждане) сам се
  проверява, раздава и оценява. Нов вид е нов файл тук и неговият изглед в клиента.

```
cmd/almanac      програмата: serve, bank check/fmt, backup now/list/restore/verify/keys
cmd/build        строи клиента в internal/assets/dist
internal/bank    въпросите: видовете, банката на диска, проверките
internal/store   SQLite и миграциите (internal/store/migrations)
internal/account гости, вход с код по имейл, сесии, имена
internal/mail    пощата: опашка в базата, SMTP
internal/play    играта: денят, темите, дуелите, приятелите, класацията, серията, статистиката
internal/room    игра на живо: стаите (Server-Sent Events)
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
go run ./cmd/almanac bank check      # банката в private/ (пада, ако не е напълно балансирана)
go run ./cmd/almanac bank check -unbalanced bank/sample   # извадката
```

Истинската банка е в частното хранилище `almanac-bg/almanac-questions`, клонирано в `private/`. Без нея играта
върви с извадката в `bank/sample`.

## Сървърът

Един сървър (Hetzner), зад Cloudflare. Програмата работи като systemd услуга (`deploy/almanac.service`) и сама
говори HTTPS със сертификата на Cloudflare за сървъра. Всеки час копира базата си в Cloudflare R2.

- Всяко сливане в `main` с feat, fix, perf или revert е ново издание: GitHub избира версията, строи програмата и
  я слага на сървъра (`.github/workflows/deploy.yml`).
- На сървъра `almanac-deploy vX.Y.Z` слага версията, когато рестартът не прекъсва игра: изчаква дуелите на живо и
  игрите в стаите (до пет минути) и не рестартира около Роял. Щом `deploy/release-signers` назове ключ, приема
  програмата само с подписа на издаването. Версия, която носи промени в базата (миграции), първо я копира (`before-vX.Y.Z.db`);
  ако новата версия не отговори до три минути или спре в следващите две, се връща предишната, с базата отпреди нея.
  Същата команда с по-стара версия връща назад, а с `now` след нея — веднага. Версия, която вече работи, не се пипа,
  затова след всяко сливане GitHub иска последното издание и пускане, което не е минало, се опитва отново.
- Промените в `deploy/` стигат до сървъра само на ръка, както ги слага `deploy/setup.sh`; дотогава GitHub отбелязва
  пускането като неуспешно.
- Нови въпроси: `almanac-bank` — проверява новата банка отделно и едва тогава я дърпа и презарежда без рестарт
  (докато тече Роял, новата банка чака края му). Сървърът играе свое копие на банката и ако тя има грешки, тръгва
  с последното добро копие.
- От копията на базата отпреди издание (`before-vX.Y.Z.db`) остават последните три, а всяко копие до базата
  (и старата база, оставена при възстановяване) се изтрива след месец.

### Резервни копия

Всеки час, в 30-ата минута, сървърът копира базата в R2 (`internal/backup`): като отделен процес с по-нисък приоритет,
за да не взима от играта нито процесор, нито памет. Копието се проверява (`integrity_check`; празна база не се
праща), компресира и шифрова с [age](https://age-encryption.org) за ключ, който не е на сървъра. Всяко копие е нов
обект с часа си (`hours/2026-11-17T153012Z.db.gz.age`), а първото за деня (UTC) отива и в `days/`: сървърът не
презаписва и не трие копия. Копието на деня веднага се сваля, разшифрова и проверява отново. Каквото не е наред
(неуспешно копие, липсващ ключ, стари копия, които R2 не е изтрил, рязко намалели редове) идва в Slack (`ALERT_SLACK`) или на `ALERT_EMAIL`
веднъж на ден.

**Ключът, веднъж.** На своя компютър, не на сървъра: `go run ./cmd/almanac backup keys` (или `age-keygen -pq`).

- Тайният ключ (`AGE-SECRET-KEY-PQ-1…`) се пази **само извън сървъра**: в мениджъра на пароли и още веднъж на
  хартия или флашка. Без него никое копие не може да се отвори. На сървъра не бива да попада: който пробие сървъра,
  би прочел с него и всички копия.
- Публичният (`BACKUP_RECIPIENT=age1pq1…`) отива в `/etc/almanac/env` и влиза в сила при следващото издание (или
  `systemctl restart almanac`). Без него копията се пращат нешифровани, както преди, и сървърът напомня всеки ден.

**R2, веднъж, в таблото на Cloudflare** (R2 → кофата `almanac-backups` → Settings):

1. *Object lifecycle rules* → Add rule: префикс `hours/`, изтриване след 2 дни; второ правило: префикс `days/`,
   изтриване след 30 дни. Така копията живеят колкото казва страницата за поверителност, а старите имена
   (`hours/07.db.gz`, `days/17.db.gz`) изчезват сами.
2. *Bucket lock rules* → Add rule: префикс `hours/`, задържане 2 дни; второ: префикс `days/`, задържане 30 дни.
   Докато трае, никой не може да изтрие или подмени копие, дори с ключа на сървъра.
3. R2 → *Manage API tokens* → Create: *Object Read & Write*, само за кофата `almanac-backups`, с *Client IP
   filtering* само за адресите на сървъра. Новите ключове — в `BACKUP_ACCESS_KEY` и `BACKUP_SECRET_KEY`, после
   старият токен се изтрива. За своя компютър: отделен токен *Object Read only* за същата кофа, пазен до тайния ключ.

**Проверка и възстановяване.** Командите на сървъра искат неговите настройки:

```bash
alias almanac-backup='systemd-run --pipe --wait --quiet -p User=almanac -p EnvironmentFile=/etc/almanac/env /usr/local/bin/almanac backup'
almanac-backup list                       # копията, най-новото отгоре
almanac-backup verify                     # последното копие на деня: цяло ли е, както е пратено
systemctl stop almanac.socket almanac
almanac-backup restore -identity - -into-place latest   # поставяш тайния ключ, Enter, Ctrl-D
systemctl start almanac.socket almanac
```

`-into-place` отказва, докато играта работи; проверява копието, преди да го сложи; оставя старата база до новата
(`replaced-….db`, с нейния `-wal`; изтрива се след месец) и маха `-shm`. Вместо `latest` — всяко име от `list`. От своя
компютър, с ключа и токена за четене, `almanac backup verify -identity ключ.txt` отваря копието и проверява и самата
база; само с age (1.3 или по-нов): `age -d -i ключ.txt копие.db.gz.age | gunzip > almanac.db`.

**Нов сървър:** `deploy/setup.sh`; `/etc/almanac/env` и файловете с ключове (виж по-долу); `almanac-deploy vX.Y.Z
now` (тръгва на празна база, която не се праща никъде); после спиране, възстановяване и пускане както горе; DNS
накрая.

**Тайните извън сървъра.** `/etc/almanac/env`, `origin.key`/`origin.pem`, `apns.p8` и `fcm.json` се пазят и в
мениджъра на пароли и се обновяват там при всяка промяна. Без `PUSH_PRIVATE_KEY` известията спират за всички.

## Лиценз

Кодът е под **GNU Affero General Public License v3.0 или по-нова** ([LICENSE](LICENSE)). Лицензът не обхваща името
АЛМАНАХ, логото и домейна almanac.bg, нито частната банка с въпроси. Снимките във въпросите са под собствените си
свободни лицензи, посочени при всяка. Шрифтовете Sofia Sans и Literata са под SIL Open Font License 1.1
([web/src/fonts/OFL.txt](web/src/fonts/OFL.txt)).

## In English

ALMANAC (АЛМАНАХ) is a Bulgarian quiz game at [almanac.bg](https://almanac.bg): ten questions a day, the same for
everyone; topic play that follows what you know; duels in each one's own time; live rooms; friends who call each
other to a duel. One Go program (stdlib + SQLite) serves a plain TypeScript client of about 23 kB. Run it with `go run
./cmd/build && DEV=1 go run ./cmd/almanac serve`. Free software under the AGPL-3.0; issues and pull requests in
English are welcome.
