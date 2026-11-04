import { api, errorMessage, setState, useStore } from '@almanac/client';
import { MORE_TIME, type MoreTime } from '@almanac/shared';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert } from 'react-native';
import { API_URL, BUILD } from '@/lib/client';
import { setSound, setTheme, type ThemeChoice, usePrefs } from '@/lib/prefs';
import { DeleteAccount, EmailForm, PasswordForm, SaveAccount } from '@/settings/forms';
import { PushSection } from '@/settings/PushSection';
import { Button, Screen, T } from '@/ui';
import { Choices, Section, Toggle } from '@/ui/controls';

const THEMES = [
  { id: 'system', label: 'Като телефона' },
  { id: 'light', label: 'Светла' },
  { id: 'dark', label: 'Тъмна' },
] as const satisfies readonly { id: ThemeChoice; label: string }[];

/** Settings: the account, how the game looks and plays, the data — the web's Settings, as far as a phone needs it. */
export default function Settings() {
  const me = useStore((s) => s.me);
  const theme = usePrefs((s) => s.theme);
  const sound = usePrefs((s) => s.sound);
  /** One of the account's choices, saved at once (the switch shows it, and goes back if it couldn't be saved). */
  const save = async (fn: () => Promise<{ user: typeof me }>) => {
    try {
      setState({ me: (await fn()).user });
    } catch (err) {
      Alert.alert('Не се запази', errorMessage(err));
    }
  };
  const open = (path: string) => void WebBrowser.openBrowserAsync(`${API_URL}${path}`);
  const signOut = async () => {
    try {
      await api.logout();
    } catch {
      /* signed out on the phone either way */
    }
    setState({ me: null });
  };
  // Signed out (or deleted) a moment before the router takes this screen away.
  if (!me) return null;
  return (
    // The title is in the header (app/_layout), with the way back.
    <Screen>
      {me.isGuest && (
        <Section title="Запази профила">
          <SaveAccount />
        </Section>
      )}
      <Section title="Изглед">
        <Choices label="Тема" options={THEMES} value={theme} onChange={(t) => void setTheme(t)} />
        <Toggle
          label="Звуци"
          hint="Звуците на играта. Беззвучният режим на телефона ги спира и без това."
          value={sound}
          onChange={(on) => void setSound(on)}
        />
      </Section>
      <Section title="Игра">
        <T variant="bodyStrong">Повече време</T>
        <T variant="small" tone="fg2">
          За Дуел, Арена и стаите остава 15 с; тук е за въпросите на деня, Соло и линковете — извън класациите.
        </T>
        <Choices
          label="Повече време"
          options={MORE_TIME}
          value={me.moreTime}
          onChange={(value: MoreTime) => void save(() => api.setMoreTime(value))}
        />
        {!me.isGuest && (
          <Toggle
            label="Записите на мачовете ми"
            hint="Други играят Дуел срещу запис на твой мач, когато няма кой друг. Името ти се вижда."
            value={me.shareRuns}
            onChange={(on) => void save(() => api.setShareRuns(on))}
          />
        )}
      </Section>
      {!me.isGuest && (
        <Section title="Имейл">
          <EmailForm />
          {me.email && (
            <>
              <Toggle
                label="Напомняне за серията"
                hint="Вечер, ако въпросите на деня още те чакат."
                value={me.streakReminders}
                onChange={(on) => void save(() => api.setReminders(on))}
              />
              <Toggle
                label="„Изпревариха те на линка ти“"
                hint="Най-много едно писмо на ден."
                value={me.beatenMails}
                onChange={(on) => void save(() => api.setBeatenMails(on))}
              />
            </>
          )}
        </Section>
      )}
      {!me.isGuest && (
        <Section title="Парола">
          <PasswordForm />
        </Section>
      )}
      <PushSection />
      <Section title="Правила и данни">
        <Button title="Условия за ползване" variant="ghost" onPress={() => open('/terms')} />
        <Button title="Политика за поверителност" variant="ghost" onPress={() => open('/privacy')} />
        <Button
          title="Изтриване на профила — как и какво остава"
          variant="ghost"
          onPress={() => open('/delete-account')}
        />
      </Section>
      <Section title="За приложението">
        <T variant="small" tone="fg2">
          Версия {BUILD.replace(/\+(.*)$/, ' ($1)')}. Свободен софтуер под GNU AGPL-3.0, с кода на други автори под
          техните лицензи.
        </T>
        <Button title="Лицензи и изходен код" variant="ghost" onPress={() => router.push('/licenses')} />
      </Section>
      <Section title="Профилът">
        {!me.isGuest && <Button title="Изход" variant="secondary" onPress={() => void signOut()} />}
        <DeleteAccount />
      </Section>
      <Button title="Назад" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
