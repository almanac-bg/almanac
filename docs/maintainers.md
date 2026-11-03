# За поддържащите

Настройките на хранилището в GitHub и как една промяна стига до продукцията.

## Настройки на хранилището в GitHub

`scripts/github-setup.sh almanac-bg/almanac` настройва хранилището в GitHub (може спокойно да се пуска повторно):
описание, уебсайт и topics, issues и discussions, squash merge, Dependabot alerts и security updates, private
vulnerability reporting, secret scanning, етикети, защитен `main` (историята му не може да се пренаписва или трие от
никого; pull request се слива само със зелен CI от GitHub Actions, а администраторът може да push-ва направо), само
actions на самия GitHub, закачени за commit, и CI за pull request отвън само след одобрение. Някои от тези
настройки съществуват само за публични хранилища, затова пусни скрипта отново, след като направиш хранилището публично.
Изображението за social preview (`.github/social-preview.png`) се качва ръчно: Settings → General → Social preview.

**Следи хранилищата.** Доклад за уязвимост (първият начин в `SECURITY.md`), issue и pull request от някой отвън
известяват само онези, които следят хранилището. Скриптът го прави за този, който го пуска (трябва му правото
`notifications` на `gh`: `gh auth refresh -h github.com -s notifications`), а иначе — бутонът Watch → Custom →
Security alerts на всяко хранилище на организацията. Къде отиват писмата: github.com/settings/notifications → Custom
routing.

## Знакът и картините

Знакът е розетката в `apps/web/public/favicon.svg`: четири листа, единият златен — четирите отговора, единият верен.
След промяна в него `npm run icons -w @almanac/web` рисува иконите на приложението (`icon-192/512`, `apple-touch-icon`,
`icon-maskable-512`, `favicon.ico`) и значката на известията, а `npm run share-images -w @almanac/web` — картините при
споделяне: `og.jpg` на сайта и `.github/social-preview.png` (качи я отново в GitHub). В интерфейса знакът е `Rosette` в
`components/Logo.tsx`, с цветовете `--logo-petal` и `--logo-gold` за двете теми.

Там, където шрифт още не е зареден или не може да се зареди — първият кадър на приложението (`index.html`), страницата
без връзка (`offline.html`) и тази на Caddy, докато приложението се рестартира (`deploy/Caddyfile`), — знакът и името
са един рисуван файл: `npm run lockup -w @almanac/web` чертае `public/brand-lockup.svg` (розетката и името от `brand.ts`
като контури от Unbounded) и го слага между маркерите `<!--lockup-->` в трите; рисува от него и заглавието на писмата
(`public/mail/lockup.png`) и знака за BIMI (`public/bimi.svg`). `test/brand.test.ts` в сървъра следи да са еднакви и
никъде да няма старата мълния.

Снимките в листа за инсталиране (`screenshots` в манифеста, `vite.config.ts`) прави `npm run store-shots -w
@almanac/web` след `npm run build`: играе изграденото приложение като гост върху примерната банка (началната страница —
върху истинската, ако е тук, за да казва колко въпроса има сайтът) и слага надписите от манифеста. Пусни го след
`lockup` или `icons` и след промяна на началната страница, лобито или въпроса.

## Пълният преглед

`/a-to-z` в Claude Code пуска пълния експертен преглед „от А до Я“: продуктът и всичко, на което стои (организацията в
GitHub, Cloudflare, сървърът, пощата, наблюдението, профилите). Рецензенти по области работят паралелно, всяка
находка се проверява от отделен агент, а резултатът е план на фази, решенията за собственика и списък какво прегледът
не е обхванал. Нищо не се променя преди „давай“. Описанието е в `.claude/skills/a-to-z/SKILL.md`.

## CodeQL

CodeQL (разширеният набор заявки) проверява кода при всеки push и pull request; pull request с открит проблем от
висока или критична степен не се слива. Всеки сигнал (Security → Code scanning) се проверява в кода: истински проблем
се поправя в същия pull request, а фалшив се отхвърля с причина (False positive / Won't fix и едно изречение защо,
напр. „throttled() inside: the limit is in the handler“), за да личи защо при следващия поглед. Целта е нула отворени.

## От commit до продукцията

Промяна влиза в `main` през pull request със зелен CI, слята със squash (`gh pr merge <n> --squash`): един commit на
промяна, и всеки commit в `main` е тестван и има образ — `deploy/rollback.sh <commit>` и `git bisect` стъпват само на
такива. CI на `main` пуска всички проверки отново и, щом минат, публикува
образа `ghcr.io/almanac-bg/almanac:<commit>` с подписано удостоверение за произход (build provenance): че точно този
образ е направен от CI на това хранилище за този commit. `deploy/deploy.sh` на сървъра взема цифровия отпечатък (digest)
на образа, проверява удостоверението и пуска точно него (виж [Поддръжка → Обновяване](operations.md#обновяване)); ръчна
проверка: `gh attestation verify oci://ghcr.io/almanac-bg/almanac:<commit> --repo almanac-bg/almanac`. Commit само с
Markdown в `docs/changelog/` не пуска CI (`paths-ignore`), а `deploy.sh` тогава пуска образа на последния commit преди
него, който има образ — кодът е същият.

Съобщението на squash commit-а е заглавието и описанието на pull request-а, затова заглавието е по Conventional Commits
(CONTRIBUTING.md → Commits и pull requests) и `.github/workflows/pr-title.yml` го проверява с commitlint при всяко
отваряне и редакция. Същата проверка пада и за `[skip ci]` (или `[ci skip]`, `[no ci]`…) където и да е в заглавието или
описанието: това спира CI на `main` за този commit — няма тестове и няма образ. Dependabot цитира в описанието
commit-ите на обновените пакети, а някои ги носят; такъв pull request се слива със собствено съобщение:
`gh pr merge <n> -R almanac-bg/almanac --squash --admin --body "<един ред>"`. Така се изпусна 89f14e2 (3 ноември): няма
образ, а промените му влязоха с commit-а след него.

**Тестове, минали чак при повторния опит.** CI ги изписва като предупреждение и качва доклада с trace и на двата
опита. Тест, който е такъв в три поредни пуска на `main`, проваля CI: нестабилен тест е бъг (в теста или в
приложението), не шум. Всеки понеделник `.github/workflows/flaky-ledger.yml` брои тези тестове във всички пускове
от седмицата и води issue с етикет `flaky` за всеки, повторил се два пъти; затваря го след 14 дни без повторение.

## Издания

Всяко пускане в продукцията е издание: версия по [Semantic Versioning](https://semver.org/spec/v2.0.0.html), таг
`vX.Y.Z` и [GitHub release](https://github.com/almanac-bg/almanac/releases) с бележки. Нищо от това не се пише на ръка:

1. При всеки push в `main` `.github/workflows/release.yml` (release-please, от npm) поддържа отворен един pull request
   `chore(release): X.Y.Z`. В него е следващата версия — MAJOR при несъвместима промяна (`!` или `BREAKING CHANGE:`),
   MINOR при `feat`, PATCH при `fix` и `perf` — във всеки `package.json` и `package-lock.json`, и разделът ѝ в
   [CHANGELOG.md](../CHANGELOG.md) от заглавията на commit-ите (`feat`, `fix`, `perf`, `revert`).
2. Сливането му е изданието: `gh pr merge <n> -R almanac-bg/almanac --squash --admin` (направен с токена на workflow-а,
   той няма свой CI: в него са само версия и бележки). Push-ът от сливането тагва commit-а `vX.Y.Z` и публикува
   release-а; CI на `main` го тества и публикува образа му.
3. Деплоят е на този commit ([Поддръжка → Обновяване](operations.md#обновяване)): в продукцията е винаги издание, а
   бележките му казват какво влезе.

Обновленията от Dependabot са по същото правило: на това, което се пуска (пакетите на приложението, образите на
Docker), са `fix(deps)` — издание с ред в бележките; на инструментите за разработка — `build(deps)`, на actions —
`ci(deps)`, без издание, защото в продукцията не се променя нищо. Затова между две издания `main` може да има commit-и
без свое издание (`ci`, `docs`, `test`, `build`): деплоят им пуска кода на последното издание.

MAJOR значи, че обновяването иска действие от поддържащ сървъра (настройка, преместени данни, премахнато нещо, на
което някой разчита); кое, казва редът `BREAKING CHANGE:` в бележките. Таговете `v*` не могат да се местят или трият,
а публикуван release — да се променя; release-please отваря своя pull request, защото „Allow GitHub Actions to create
pull requests“ е включено (всичко това: `scripts/github-setup.sh`). Историята от преди 1.2.0, по деплой и на български,
е в `docs/changelog/`.
