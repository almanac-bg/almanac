# Changelog

Every release of АЛМАНАХ, newest first. Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): each
is a `vX.Y.Z` tag and a [GitHub release](https://github.com/almanac-bg/almanac/releases) with these notes, made by
[release-please](https://github.com/googleapis/release-please) from the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) since the release before
([docs/maintainers.md → Издания](docs/maintainers.md#издания)). Until 1.2.0 the history was kept deploy by deploy, in
Bulgarian: [October 2026](docs/changelog/2026-10.md), with 0.9.0, 1.0.0 and 1.1.0, and
[November 2026 until 1.2.0](docs/changelog/2026-11.md), what came after 1.1.0.

## [1.5.0](https://github.com/almanac-bg/almanac/compare/v1.4.0...v1.5.0) (2026-11-04)


### Features

* **mobile:** licences and the source of this version, in Settings ([#138](https://github.com/almanac-bg/almanac/issues/138)) ([b740fd2](https://github.com/almanac-bg/almanac/commit/b740fd2e3231112577c9e0b9958dd4acc268db7c))


### Bug Fixes

* **deps:** bump motion from 14.7.1 to 14.8.0 in the npm-minor group across 1 directory ([#109](https://github.com/almanac-bg/almanac/issues/109)) ([e57fc09](https://github.com/almanac-bg/almanac/commit/e57fc0989af347d3751962b2534e35725cfed0b4))
* **mobile:** pushes that reach the phone, on iOS and on Android ([#140](https://github.com/almanac-bg/almanac/issues/140)) ([f84d2f9](https://github.com/almanac-bg/almanac/commit/f84d2f9c5bedd5c1dfcec83b49ea05bdaf80e97d))
* **mobile:** the sounds' expo-asset built in; Expo's doctor in CI ([#142](https://github.com/almanac-bg/almanac/issues/142)) ([032b941](https://github.com/almanac-bg/almanac/commit/032b941d78147a676624acd06d6a1dac42155ce3))
* **web:** a retry of a page's code that fails again reloads the page ([#143](https://github.com/almanac-bg/almanac/issues/143)) ([b995832](https://github.com/almanac-bg/almanac/commit/b995832d7ba10fac777563b680d50982fe07c380))

## [1.4.0](https://github.com/almanac-bg/almanac/compare/v1.3.0...v1.4.0) (2026-11-04)


### Features

* **mobile:** challenge links and friend duels: play, share, rematch ([#119](https://github.com/almanac-bg/almanac/issues/119)) ([81bb031](https://github.com/almanac-bg/almanac/commit/81bb031f1dfc26fb6456f5a8c139c35dbe2c8520))
* **mobile:** collection and achievements, from your profile and the results ([#126](https://github.com/almanac-bg/almanac/issues/126)) ([255d665](https://github.com/almanac-bg/almanac/commit/255d6653e11365781ef3f6a4d09053829bdc0a7c))
* **mobile:** every link the app takes lands on a screen: the day's too ([#127](https://github.com/almanac-bg/almanac/issues/127)) ([cbc8d7d](https://github.com/almanac-bg/almanac/commit/cbc8d7df19bd9b62212f50cde5a2fe8f121cf18e))
* **mobile:** every player shown in their own avatar and frame ([#133](https://github.com/almanac-bg/almanac/issues/133)) ([7cb5fad](https://github.com/almanac-bg/almanac/commit/7cb5fad486199ee81b31da17ff440936470fea48))
* **mobile:** friends: add, requests, presence, a duel with a friend ([#115](https://github.com/almanac-bg/almanac/issues/115)) ([b4eb667](https://github.com/almanac-bg/almanac/commit/b4eb667349fba658a7a41d3af587a5897d349c6b))
* **mobile:** groups: make one, the week's board, the invite link ([#128](https://github.com/almanac-bg/almanac/issues/128)) ([80c982a](https://github.com/almanac-bg/almanac/commit/80c982ad46ee5711abb39a4db917101560d43f71))
* **mobile:** home and tabs: play, queue up, Соло's choices ([#112](https://github.com/almanac-bg/almanac/issues/112)) ([8b7b99c](https://github.com/almanac-bg/almanac/commit/8b7b99ce4bfd441c9caf0f5f86d2a8d807c7f204))
* **mobile:** home in full: the evening Роял, quests, links, nudges, ranks ([#122](https://github.com/almanac-bg/almanac/issues/122)) ([b7e59ea](https://github.com/almanac-bg/almanac/commit/b7e59ea196198ad64080ca67d2078a24e0457544))
* **mobile:** knowledge: the facts by category, their search, Поправителен ([#116](https://github.com/almanac-bg/almanac/issues/116)) ([231ca96](https://github.com/almanac-bg/almanac/commit/231ca96279d26a2300f9fdcdcccd4028ea376ba7))
* **mobile:** leaderboards: by level, the day's, each ranked season ([#114](https://github.com/almanac-bg/almanac/issues/114)) ([32208b6](https://github.com/almanac-bg/almanac/commit/32208b6429feaec8755e6761c7aa86015118e7a0))
* **mobile:** notifications on the phone: on, off, what to send, a tap ([#131](https://github.com/almanac-bg/almanac/issues/131)) ([c002848](https://github.com/almanac-bg/almanac/commit/c0028488e168bf2d9bb38466bf865d791262a1b4))
* **mobile:** notifications: the list, its links, the bell with the count ([#118](https://github.com/almanac-bg/almanac/issues/118)) ([f42ff17](https://github.com/almanac-bg/almanac/commit/f42ff175d1d3ddef771499e4882ebd9a774e19f3))
* **mobile:** own question sets: made, edited, shared, played in a room ([#129](https://github.com/almanac-bg/almanac/issues/129)) ([00cbd1e](https://github.com/almanac-bg/almanac/commit/00cbd1ed5efb8d7ad382ab37f2ebba926886fd8a))
* **mobile:** play a match: the day's questions and Соло ([#110](https://github.com/almanac-bg/almanac/issues/110)) ([b5814c1](https://github.com/almanac-bg/almanac/commit/b5814c185b2b5ab9fb20127215d82bdf98183dcf))
* **mobile:** play with others: standings, powerups, reactions, knockouts ([#111](https://github.com/almanac-bg/almanac/issues/111)) ([d15f2d7](https://github.com/almanac-bg/almanac/commit/d15f2d75403b327fa62d227959a1cfc5ad8ffd52))
* **mobile:** private rooms: make one, join by code, the lobby ([#121](https://github.com/almanac-bg/almanac/issues/121)) ([54d9986](https://github.com/almanac-bg/almanac/commit/54d99869aca3c86e5537c266b6e42c228ed320ec))
* **mobile:** profiles: anyone's numbers, friends, a report, a block ([#117](https://github.com/almanac-bg/almanac/issues/117)) ([b865d43](https://github.com/almanac-bg/almanac/commit/b865d4348c1a2700a43ddb467fb658fb40ed393c))
* **mobile:** results in full: the outcome, standings, rewards, next step ([#123](https://github.com/almanac-bg/almanac/issues/123)) ([ad77c8e](https://github.com/almanac-bg/almanac/commit/ad77c8e836a5cb3f9a6c364909bfa8d06656a541))
* **mobile:** settings: save a guest's account, theme, choices, data ([#113](https://github.com/almanac-bg/almanac/issues/113)) ([e8b3ea4](https://github.com/almanac-bg/almanac/commit/e8b3ea4dbc24396339b97d659bcefc01a452a628))
* **mobile:** submit a question for the bank, and see yours waiting ([#130](https://github.com/almanac-bg/almanac/issues/130)) ([f2d90e1](https://github.com/almanac-bg/almanac/commit/f2d90e1fb6ab50ec00a20ef4f062d98d9ed75108))
* **mobile:** the app's foundation, on main ([#107](https://github.com/almanac-bg/almanac/issues/107)) ([cf387c1](https://github.com/almanac-bg/almanac/commit/cf387c11a9acfef287c16a38c4784c22c453ce71))
* **mobile:** the game's sounds, the web's own, with „Звуци“ to turn them off ([#132](https://github.com/almanac-bg/almanac/issues/132)) ([452044d](https://github.com/almanac-bg/almanac/commit/452044d0b8cc51712da38603bf9bc187da90ceb8))
* **mobile:** the home card says what waits: the day's bonus, a level's reward, a guest's save ([#136](https://github.com/almanac-bg/almanac/issues/136)) ([33a06f1](https://github.com/almanac-bg/almanac/commit/33a06f11bc735ca345d6020bf730037af358e421))
* **mobile:** the privacy manifest's required-reason APIs, said (8o.5) ([#134](https://github.com/almanac-bg/almanac/issues/134)) ([349bb75](https://github.com/almanac-bg/almanac/commit/349bb75253b81abc9f4ee913f1041d5d073d665c))
* **mobile:** the questions reviewed and reported, pictures' credits, rematch ([#125](https://github.com/almanac-bg/almanac/issues/125)) ([7314abf](https://github.com/almanac-bg/almanac/commit/7314abfa1185404d971413ccd770efdde3f665fa))
* **mobile:** the reward moment: a new level, one of two, a new avatar ([#124](https://github.com/almanac-bg/almanac/issues/124)) ([ecd45cc](https://github.com/almanac-bg/almanac/commit/ecd45ccf296478204eb4742dfd38c9847293171b))
* **mobile:** toasts, invitations to Отбори, and Отбори with a friend ([#120](https://github.com/almanac-bg/almanac/issues/120)) ([2d2e906](https://github.com/almanac-bg/almanac/commit/2d2e906389863c4f8b3adcef900c407d31e69d5a))


### Bug Fixes

* **mobile:** a link opened while signed out waits, and opens once you're in ([#135](https://github.com/almanac-bg/almanac/issues/135)) ([52cae7f](https://github.com/almanac-bg/almanac/commit/52cae7fb6405a331595cdb9b5ab542d8a0f6f3af))

## [1.3.0](https://github.com/almanac-bg/almanac/compare/v1.2.1...v1.3.0) (2026-11-03)


### Features

* **client:** platform hooks, so the shared client runs in React Native ([#96](https://github.com/almanac-bg/almanac/issues/96)) ([b1e6cac](https://github.com/almanac-bg/almanac/commit/b1e6cac5dd643147b465a1efe3ad4b65910fdd6a))
* **server:** a room's players report the set it played ([#101](https://github.com/almanac-bg/almanac/issues/101)) ([5020df1](https://github.com/almanac-bg/almanac/commit/5020df13457063dc9e8db17ee320fdd9bdc7135d))
* **server:** guests report and block, and blocked players never meet ([#99](https://github.com/almanac-bg/almanac/issues/99)) ([9d55692](https://github.com/almanac-bg/almanac/commit/9d55692ede80a67e220d1e1a08827ce08fa682d8))
* **server:** pushes to the apps, straight to Apple and Google ([#102](https://github.com/almanac-bg/almanac/issues/102)) ([90a6c9c](https://github.com/almanac-bg/almanac/commit/90a6c9c7096d3ee52661fb77c7fbf3450abae73c))
* **server:** sessions an app can hold without cookies ([#100](https://github.com/almanac-bg/almanac/issues/100)) ([b842ce7](https://github.com/almanac-bg/almanac/commit/b842ce7dbcc948d4b0682cacbbd18c7d853b1cc2))
* **server:** tell clients older than the protocol to update ([#94](https://github.com/almanac-bg/almanac/issues/94)) ([2fc4c36](https://github.com/almanac-bg/almanac/commit/2fc4c36c987e9add2c66b3d4e9c12666db22b906))
* **server:** the apps' claim to the site's links ([#105](https://github.com/almanac-bg/almanac/issues/105)) ([79ac4ea](https://github.com/almanac-bg/almanac/commit/79ac4ea2994e53ffcadad183131f4b32689ed7a8))
* **web:** a public page on deleting an account ([#106](https://github.com/almanac-bg/almanac/issues/106)) ([4d7a3b4](https://github.com/almanac-bg/almanac/commit/4d7a3b474a277bb76222a0a0112716964d2ced0b))

## [1.2.1](https://github.com/almanac-bg/almanac/compare/v1.2.0...v1.2.1) (2026-11-03)


### Bug Fixes

* **deps:** bump node from 26.12.1-alpine to 26.13.0-alpine ([#87](https://github.com/almanac-bg/almanac/issues/87)) ([2d3bd68](https://github.com/almanac-bg/almanac/commit/2d3bd68f79a41d438b1ad051df2406a7360dd099))
* **deps:** bump nodemailer from 10.3.0 to 10.3.1 in the npm-minor group across 1 directory ([#88](https://github.com/almanac-bg/almanac/issues/88)) ([264acda](https://github.com/almanac-bg/almanac/commit/264acdafecbd44fb27b940bffa5ff852c320cb14))

## [1.2.0](https://github.com/almanac-bg/almanac/compare/v1.1.0...v1.2.0) (2026-11-03)


### Bug Fixes

* **web:** keep entrances still under reduced motion ([#84](https://github.com/almanac-bg/almanac/issues/84)) ([e8a90e4](https://github.com/almanac-bg/almanac/commit/e8a90e4c192ab840e1c8341d96c482e1d948d19b))


### Miscellaneous Chores

* **release:** release 1.2.0 ([79d5225](https://github.com/almanac-bg/almanac/commit/79d52250f7abbbe7a1d694173687450f347874a4))

## [1.1.0](https://github.com/almanac-bg/almanac/releases/tag/v1.1.0) (2026-11-03)

October after the launch: [docs/changelog/2026-10.md](docs/changelog/2026-10.md).

## [1.0.0](https://github.com/almanac-bg/almanac/releases/tag/v1.0.0) (2026-10-26)

The launch, after the full review: [docs/changelog/2026-10.md](docs/changelog/2026-10.md).

## [0.9.0](https://github.com/almanac-bg/almanac/releases/tag/v0.9.0) (2026-10-25)

Ready for the launch: [docs/changelog/2026-10.md](docs/changelog/2026-10.md).
