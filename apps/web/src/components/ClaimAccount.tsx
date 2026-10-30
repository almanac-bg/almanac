import { api, errorMessage, setState, toast, useStore } from '@quiz/client';
import { PASSWORD_MIN_LENGTH, USERNAME } from '@quiz/shared';
import { Save } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { type CredentialField, credentialsProblems } from '../lib/credentials';
import { markReturning } from '../lib/returning';
import { MINORS_NOTICE } from './LegalLinks';
import { PasswordField } from './PasswordField';
import { Button, Field, INPUT, Modal } from './ui';

/**
 * A guest picks a name and password (and maybe an email): the same account from then on, with all its XP, streak and
 * history. `reason` says why it's being asked for (e.g. "За да добавяш приятели…").
 */
export function ClaimAccountModal({
  open,
  onClose,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  reason?: ReactNode;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The fields the error is about (when the check here found them): marked while the message shows.
  const [invalid, setInvalid] = useState<CredentialField[]>([]);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problems = credentialsProblems(username, password, { newAccount: true });
    setInvalid(problems.map((p) => p.field));
    if (problems.length) {
      (problems[0].field === 'username' ? usernameRef : passwordRef).current?.focus();
      return setError(problems.map((p) => p.message).join(' '));
    }
    setError(null);
    setBusy(true);
    try {
      const { user } = await api.claim(username.trim(), password, email.trim() || undefined);
      markReturning();
      setState({ me: user });
      toast(
        {
          kind: 'success',
          title: 'Профилът е запазен!',
          body: `Вече влизаш като ${user.username} — от всяко устройство.`,
        },
        6000,
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Запази прогреса си">
      <p className="-mt-2 text-sm text-fg-2">
        {reason ?? 'Избери име и парола — нивото, серията и всичко изиграно досега остават твои, на всяко устройство.'}
      </p>
      <form onSubmit={submit} noValidate className="mt-5 space-y-4">
        <Field label="Потребителско име" htmlFor={`${id}-username`}>
          <input
            id={`${id}-username`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            aria-invalid={!!error && invalid.includes('username')}
            aria-describedby={error && invalid.includes('username') ? `${id}-error` : undefined}
            ref={usernameRef}
            required
            minLength={USERNAME.min}
            maxLength={USERNAME.max}
            placeholder="напр. Мозъчко"
            className={INPUT}
          />
        </Field>
        <Field label="Имейл (по желание)" htmlFor={`${id}-email`}>
          <input
            id={`${id}-email`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="за възстановяване на паролата"
            className={INPUT}
          />
        </Field>
        <PasswordField
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          invalid={!!error && invalid.includes('password')}
          describedBy={error && invalid.includes('password') ? `${id}-error` : undefined}
          inputRef={passwordRef}
          minLength={PASSWORD_MIN_LENGTH}
          placeholder={`поне ${PASSWORD_MIN_LENGTH} знака`}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          <Save className="size-4.5" /> Запази профила
        </Button>
        <p className="text-center text-xs text-fg-3">{MINORS_NOTICE}</p>
      </form>
    </Modal>
  );
}

/**
 * For guests only: a quiet reminder that progress lives on this device until the account is saved — or, for a guest who
 * came for a room, that it all goes within an hour of leaving.
 */
export function GuestNudge({ className = '', children }: { className?: string; children?: ReactNode }) {
  const guest = useStore((s) => !!s.me?.isGuest);
  const roomGuest = useStore((s) => !!s.me?.roomGuest);
  const [open, setOpen] = useState(false);
  if (!guest) return null;
  if (roomGuest && !children)
    children =
      'Влезе като гост за стая: до час, след като излезеш от сайта, профилът и играта ти се изтриват. Запази ги с име и парола, ако искаш да останат.';
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 ${className}`}
    >
      <p className="min-w-0 flex-1 basis-56 text-sm text-amber-100">
        {children ?? 'Играеш като гост: прогресът е само на това устройство. Запази го с име и парола.'}
      </p>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Save className="size-4" /> Запази прогреса
      </Button>
      <ClaimAccountModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
