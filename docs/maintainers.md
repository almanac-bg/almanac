# За поддържащите

Настройките на хранилището в GitHub и как една промяна стига до продукцията.

## Настройки на хранилището в GitHub

`scripts/github-setup.sh almanac-bg/almanac` настройва хранилището в GitHub (може спокойно да се пуска повторно):
описание, уебсайт и topics, issues и discussions, squash merge, Dependabot alerts и security updates, private
vulnerability reporting, secret scanning, етикети, защитен `main` (pull request се слива само със зелен CI;
администраторът може да push-ва направо) и само actions от GitHub и проверени автори, закачени за commit. Някои от тези
настройки съществуват само за публични хранилища, затова пусни скрипта отново, след като направиш хранилището публично.
Изображението за social preview (`.github/social-preview.png`) се качва ръчно: Settings → General → Social preview.

## От commit до продукцията

Промяна влиза в `main` през pull request със зелен CI. CI на `main` пуска всички проверки отново и, щом минат, публикува
образа `ghcr.io/almanac-bg/almanac:<commit>`; `deploy/deploy.sh` на сървъра пуска точно него (виж
[Поддръжка → Обновяване](operations.md#обновяване)). Всяко внедряване получава запис в [CHANGELOG.md](../CHANGELOG.md):
датата и часът (софийско време), commit-ът и какво влезе.
