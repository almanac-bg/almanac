import { api, errorMessage, setState, useStore } from '@almanac/client';
import { useState } from 'react';
import { Alert } from 'react-native';
import { signedIn } from '@/lib/client';
import { Button, Field, T } from '@/ui';

/** A form's busy state and its error, around one request. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | undefined>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone((await fn()) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const status = error ? (
    <T variant="small" tone="bad" role="alert">
      {error}
    </T>
  ) : done ? (
    <T variant="small" tone="good" accessibilityLiveRegion="polite">
      {done}
    </T>
  ) : null;
  return { busy, run, status };
}

/**
 * A guest's account, saved with a name and a password (and an address, if they want): the level, the streak and all
 * of it stay, on any device. A new session comes with it (the guest's ends).
 */
export function SaveAccount() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const { busy, run, status } = useSubmit();
  return (
    <>
      <T variant="small" tone="fg2">
        Играеш като гост. Запази прогреса с име и парола — нивото, серията и всичко изиграно остават твои, на всяко
        устройство.
      </T>
      <Field
        label="Име"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoComplete="username-new"
      />
      <Field
        label="Парола"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Field
        label="Имейл (по желание) — за нова парола, ако я забравиш"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      {status}
      <Button
        title="Запази профила"
        loading={busy}
        disabled={!username.trim() || !password}
        onPress={() =>
          void run(async () => {
            await signedIn(await api.claim(username.trim(), password, email.trim() || undefined));
            return 'Профилът е запазен.';
          })
        }
      />
    </>
  );
}

/** A new address (with the password, as on the web): a link to it confirms it. */
export function EmailForm() {
  const me = useStore((s) => s.me);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, run, status } = useSubmit();
  if (!me) return null;
  return (
    <>
      <T variant="small" tone="fg2">
        {me.email ? `Сега: ${me.email}` : 'Още няма имейл.'}
        {me.pendingEmail ? ` Чака потвърждение: ${me.pendingEmail}.` : ''}
        {me.emailBounced ? ' Писмата до него не стигат — напомнянията са спрени.' : ''}
      </T>
      <Field
        label="Нов имейл"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <Field
        label="Парола"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
      />
      {status}
      <Button
        title="Изпрати линк за потвърждение"
        variant="secondary"
        loading={busy}
        disabled={!email.trim() || !password}
        onPress={() =>
          void run(async () => {
            const { user } = await api.setEmail(email.trim(), password);
            setState({ me: user });
            setPassword('');
            return 'Пратихме линк на новия адрес: отвори го, за да го потвърдиш.';
          })
        }
      />
    </>
  );
}

/** A new password: the current one first. Every other session is signed out; this one stays. */
export function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { busy, run, status } = useSubmit();
  return (
    <>
      <Field
        label="Сегашна парола"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoComplete="current-password"
      />
      <Field
        label="Нова парола"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      {status}
      <Button
        title="Смени паролата"
        variant="secondary"
        loading={busy}
        disabled={!current || !next}
        onPress={() =>
          void run(async () => {
            await api.changePassword(current, next);
            setCurrent('');
            setNext('');
            return 'Паролата е сменена. Другите устройства излязоха от профила.';
          })
        }
      />
    </>
  );
}

/** Deleting the account, at once and for good: confirmed with the password (a guest has none to give). */
export function DeleteAccount() {
  const me = useStore((s) => s.me);
  const [password, setPassword] = useState('');
  const { busy, run, status } = useSubmit();
  if (!me) return null;
  const remove = () =>
    Alert.alert(
      'Изтриване на профила',
      me.isGuest
        ? 'Профилът на гост, нивото, статистиката и постиженията ти ще бъдат изтрити завинаги. Това не може да се отмени.'
        : 'Профилът, нивото, статистиката, постиженията и приятелите ти ще бъдат изтрити завинаги. Това не може да се отмени.',
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Изтрий',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await api.deleteAccount(me.isGuest ? '' : password);
              setState({ me: null });
              return undefined;
            }),
        },
      ],
    );
  return (
    <>
      {!me.isGuest && (
        <Field
          label="Потвърди с паролата си"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
        />
      )}
      {status}
      <Button
        title="Изтрий профила"
        variant="danger"
        loading={busy}
        disabled={!me.isGuest && !password}
        onPress={remove}
      />
    </>
  );
}
