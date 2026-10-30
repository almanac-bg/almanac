# За поддържащите

Настройките на хранилището в GitHub и как една промяна стига до продукцията.

## Настройки на хранилището в GitHub

`scripts/github-setup.sh almanac-bg/almanac` настройва хранилището в GitHub (може спокойно да се пуска повторно):
описание, уебсайт и topics, issues и discussions, squash merge, Dependabot alerts и security updates, private
vulnerability reporting, secret scanning, етикети, защитен `main` (pull request се слива само със зелен CI;
администраторът може да push-ва направо) и само actions от GitHub и проверени автори, закачени за commit. Някои от тези
настройки съществуват само за публични хранилища, затова пусни скрипта отново, след като направиш хранилището публично.
Изображението за social preview (`.github/social-preview.png`) се качва ръчно: Settings → General → Social preview.

## Знакът и картините

Знакът е розетката в `apps/web/public/favicon.svg`: четири листа, единият златен — четирите отговора, единият верен.
След промяна в него `npm run icons -w @quiz/web` рисува иконите на приложението (`icon-192/512`, `apple-touch-icon`,
`icon-maskable-512`, `favicon.ico`) и значката на известията, а `npm run share-images -w @quiz/web` — картините при
споделяне: `og.jpg` на сайта и `.github/social-preview.png` (качи я отново в GitHub). В интерфейса знакът е `Rosette` в
`NavBar.tsx`, с цветовете `--logo-petal` и `--logo-gold` за двете теми.

## CodeQL

CodeQL (разширеният набор заявки) проверява кода при всеки push и pull request; pull request с открит проблем от
висока или критична степен не се слива. Всеки сигнал (Security → Code scanning) се проверява в кода: истински проблем
се поправя в същия pull request, а фалшив се отхвърля с причина (False positive / Won't fix и едно изречение защо,
напр. „throttled() inside: the limit is in the handler“), за да личи защо при следващия поглед. Целта е нула отворени.

## От commit до продукцията

Промяна влиза в `main` през pull request със зелен CI. CI на `main` пуска всички проверки отново и, щом минат, публикува
образа `ghcr.io/almanac-bg/almanac:<commit>` с подписано удостоверение за произход (build provenance): че точно този
образ е направен от CI на това хранилище за този commit. `deploy/deploy.sh` на сървъра взема цифровия отпечатък (digest)
на образа, проверява удостоверението и пуска точно него (виж [Поддръжка → Обновяване](operations.md#обновяване)); ръчна
проверка: `gh attestation verify oci://ghcr.io/almanac-bg/almanac:<commit> --repo almanac-bg/almanac`. Всяко внедряване
получава запис в [CHANGELOG.md](../CHANGELOG.md): датата и часът (софийско време), commit-ът и какво влезе.
