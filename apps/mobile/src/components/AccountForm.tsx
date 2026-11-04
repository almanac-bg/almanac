import { api, errorMessage } from '@almanac/client';
import { router } from 'expo-router';
import { useState } from 'react';
import { Consent } from '@/components/Consent';
import { signedIn } from '@/lib/client';
import { Button, Field, Screen, T } from '@/ui';

/** Signing in, or making an account: a name and a password (and, for a new one, an address if the player wants). */
export function AccountForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signUp = mode === 'sign-up';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signedIn(
        signUp
          ? await api.register(username.trim(), password, email.trim() || undefined)
          : await api.login(username.trim(), password),
      );
      // Signed in: the router takes the player to the tabs (_layout.tsx → Stack.Protected).
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Screen centered>
      <T variant="h1" align="center" role="heading">
        {signUp ? 'Създай профил' : 'Вход'}
      </T>
      <Field
        label="Име"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={signUp ? 'username-new' : 'username'}
        textContentType={signUp ? 'username' : 'username'}
        returnKeyType="next"
      />
      <Field
        label="Парола"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={signUp ? 'new-password' : 'current-password'}
        textContentType={signUp ? 'newPassword' : 'password'}
        returnKeyType={signUp ? 'next' : 'go'}
        onSubmitEditing={signUp ? undefined : () => void submit()}
      />
      {signUp && (
        <Field
          label="Имейл (по желание) — за нова парола, ако я забравиш"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
      )}
      {error ? (
        <T variant="small" tone="bad" align="center" role="alert">
          {error}
        </T>
      ) : null}
      <Button
        title={signUp ? 'Създай профил' : 'Влез'}
        size="lg"
        loading={busy}
        disabled={!username.trim() || !password}
        onPress={() => void submit()}
      />
      {/* Back to where the player came from; opened first (a link, a restart), to the welcome. */}
      <Button
        title="Назад"
        variant="ghost"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
      />
      {signUp && <Consent />}
    </Screen>
  );
}
