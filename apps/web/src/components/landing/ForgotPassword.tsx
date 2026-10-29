import { api, errorMessage } from '@quiz/client';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { Button, Field, INPUT } from '../ui';
import { DESKTOP } from './device';

export function ForgotPassword({ initial, onBack }: { initial: string; onBack: () => void }) {
  const [login, setLogin] = useState(initial);
  const id = useId();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!login.trim()) return setError('Въведи име или имейл.');
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(login.trim());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="focus-ring -my-2.5 inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-fg-3 hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Обратно към вход
      </button>
      <h2 className="mt-5 t-section">Забравена парола</h2>
      {sent ? (
        <div className="mt-4 space-y-3 text-sm text-fg-2">
          <p className="rounded-2xl bg-emerald-500/10 p-4 text-emerald-200">
            <MailCheck className="mb-2 size-6" />
            Ако профилът има потвърден имейл, изпратихме линк за нова парола. Провери пощата си (и папката за спам).
            Линкът е валиден 1 час.
          </p>
          <p className="text-fg-3">Без потвърден имейл паролата не може да се възстанови — тогава създай нов профил.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <p className="text-sm text-fg-3">
            Въведи потребителското си име или потвърдения си имейл. Ще ти изпратим линк за нова парола.
          </p>
          <Field label="Потребителско име или имейл" htmlFor={id}>
            <input
              id={id}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
              // biome-ignore lint/a11y/noAutofocus: desktop only (DESKTOP): on a phone it would pop the keyboard
              autoFocus={DESKTOP}
              autoComplete="username"
              className={INPUT}
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Изпрати линк
          </Button>
        </form>
      )}
    </div>
  );
}
