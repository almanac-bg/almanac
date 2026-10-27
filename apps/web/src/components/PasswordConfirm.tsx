import { api, errorMessage, onPasswordNeeded, useStore } from '@quiz/client';
import { ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Button, Field, INPUT, Modal } from './ui';

/**
 * Asks a moderator for their password again when a change (a ban, a rename, an approved question…) comes more than an
 * hour after they last gave it: a session left open on a shared computer can't moderate. Mounted once, for the whole
 * app; the change goes through as soon as the password is confirmed.
 */
export function PasswordConfirm() {
  const username = useStore((s) => s.me?.username ?? '');
  const [answer, setAnswer] = useState<((confirmed: boolean) => void) | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => onPasswordNeeded(() => new Promise<boolean>((resolve) => setAnswer(() => resolve))), []);

  function close(confirmed: boolean) {
    answer?.(confirmed);
    setAnswer(null);
    setPassword('');
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.confirmPassword(password);
      close(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!answer} onClose={() => close(false)} title="Потвърди, че си ти">
      <p className="-mt-2 text-sm text-fg-2">Промените като модератор искат паролата ти поне веднъж на час.</p>
      <form onSubmit={submit} noValidate className="mt-5 space-y-4">
        {/* For password managers: which account the password is for. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <Field label="Парола" htmlFor={`${id}-password`}>
          <input
            id={`${id}-password`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            required
            className={INPUT}
          />
        </Field>
        {error && (
          <p id={`${id}-error`} role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!password}>
          <ShieldCheck className="size-4.5" /> Потвърди
        </Button>
      </form>
    </Modal>
  );
}
