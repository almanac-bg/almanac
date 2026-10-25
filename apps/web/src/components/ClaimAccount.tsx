import { api, setState, toast, useStore } from '@quiz/client';
import { Eye, EyeOff, Save } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { markReturning } from '../lib/returning';
import { Button, Modal } from './ui';

const INPUT =
  'h-12 w-full rounded-2xl border border-line bg-black/30 px-4 text-[15px] outline-none placeholder:text-fg-3 focus:border-violet-400/60 focus:bg-black/40';

/**
 * A guest picks a name and password (and maybe an email): the same account from then on, with all its XP, streak and
 * history. `reason` says why it's being asked for (e.g. "За да добавяш приятели…").
 */
export function ClaimAccountModal({ open, onClose, reason }: { open: boolean; onClose: () => void; reason?: ReactNode }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await api.claim(username.trim(), password, email.trim() || undefined);
      markReturning();
      setState({ me: user });
      toast({ kind: 'success', title: 'Профилът е запазен!', body: `Вече влизаш като ${user.username} — от всяко устройство.` }, 6000);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нещо се обърка.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Запази прогреса си">
      <p className="-mt-2 text-sm text-fg-2">
        {reason ?? 'Избери име и парола — нивото, серията и всичко изиграно досега остават твои, на всяко устройство.'}
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Потребителско име">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            minLength={3}
            maxLength={20}
            placeholder="напр. Мозъчко"
            className={INPUT}
          />
        </Field>
        <Field label="Парола">
          <div className="relative">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={6}
              placeholder="поне 6 символа"
              className={`${INPUT} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? 'Скрий паролата' : 'Покажи паролата'}
              className="focus-ring absolute top-1/2 right-0.5 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-fg-3 hover:text-fg"
            >
              {show ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
            </button>
          </div>
        </Field>
        <Field label="Имейл (по желание)">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="за възстановяване на паролата"
            className={INPUT}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          <Save className="size-4.5" /> Запази профила
        </Button>
      </form>
    </Modal>
  );
}

/** For guests only: a quiet reminder that progress lives on this device until the account is saved. */
export function GuestNudge({ className = '', children }: { className?: string; children?: ReactNode }) {
  const guest = useStore((s) => !!s.me?.isGuest);
  const [open, setOpen] = useState(false);
  if (!guest) return null;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 ${className}`}>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">{label}</span>
      {children}
    </label>
  );
}
