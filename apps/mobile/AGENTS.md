# The app (apps/mobile)

АЛМАНАХ for iOS and Android: Expo SDK 58 (React Native 0.88, Expo Router) on the same core as the website
(`packages/client`, `packages/shared`). CONTRIBUTING.md → Приложението has the commands; the repository's rules
(Conventional Commits, Bulgarian gender-neutral text, tests with every change) apply here too.

- **Expo changes every SDK: check the versioned docs, not memory.** https://docs.expo.dev/versions/v58.0.0/ and
  https://docs.expo.dev/llms.txt (append `.md` to any docs page for Markdown).
- Its own install (`npm ci` here), outside the root's workspaces; `npx expo install <package>` for any dependency.
- Routes in `src/app/` (every file a screen), everything else outside it; text through `<T>` (`src/ui/Text.tsx`).
- Never create or edit `ios/` or `android/`: they're generated from `app.config.ts` (and config plugins).
- Before calling a change done: `npm run typecheck`, `npm test`, `npm run bundle`, `npx expo-doctor` (what a native
  build needs that no test sees), and `npm run lint` at the root.
