import { CheckCircle2, Download, Eye, EyeOff, KeyRound, Mail, MailCheck, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../components/NavBar';
import { Button, Card, Modal, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { refreshMe, socket } from '../lib/socket';
import { setState, toast, useStore } from '../lib/store';

const INPUT =
  'h-12 w-full rounded-2xl border border-line bg-black/30 px-4 text-[15px] outline-none placeholder:text-fg-3 focus:border-violet-400/60 focus:bg-black/40';

function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        className={`${INPUT} pr-12`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-label={show ? 'Скрий паролата' : 'Покажи паролата'}
        className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-xl text-fg-3 hover:text-fg"
      >
        {show ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
      </button>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">{children}</span>;
}

/** Standalone screen used by the email links (works signed in or out). */
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4 py-10">
      <Link to="/" className="mb-6 self-center text-3xl">
        <Logo />
      </Link>
      <Card className="bg-ink-2/70 p-6 sm:p-8">{children}</Card>
    </div>
  );
}

// ─── /reset-password?token=… ─────────────────────────────────────────────────

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setError('Паролата трябва да е поне 6 символа.');
    if (password !== confirm) return setError('Паролите не съвпадат.');
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.resetPassword(token, password);
      setState({ me: user, authChecked: true });
      toast({ kind: 'success', title: 'Паролата е сменена. Здравей отново!' });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нещо се обърка.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <KeyRound className="size-8 text-violet-300" />
      <h1 className="mt-3 font-display text-2xl font-bold">Нова парола</h1>
      {!token ? (
        <p className="mt-3 text-sm text-rose-300">Линкът е непълен. Отвори го отново от писмото.</p>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block">
            <Label>Нова парола</Label>
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder="поне 6 символа" />
          </label>
          <label className="block">
            <Label>Повтори паролата</Label>
            <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </label>
          {error && <p className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Запази и влез
          </Button>
          <p className="text-xs text-fg-3">Всички други устройства ще бъдат отписани.</p>
        </form>
      )}
    </Centered>
  );
}

// ─── /verify-email?token=… ───────────────────────────────────────────────────

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const signedIn = useStore((s) => !!s.me);
  const [state, setLocal] = useState<'working' | 'done' | { error: string }>('working');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) return setLocal({ error: 'Линкът е непълен. Отвори го отново от писмото.' });
    api
      .verifyEmail(token)
      .then(() => {
        setLocal('done');
        void refreshMe();
      })
      .catch((err) => setLocal({ error: err instanceof Error ? err.message : 'Нещо се обърка.' }));
  }, [token]);

  return (
    <Centered>
      {state === 'working' ? (
        <div className="grid place-items-center gap-3 py-6 text-fg-2">
          <Spinner className="size-8 text-violet-400" />
          Потвърждаваме имейла…
        </div>
      ) : state === 'done' ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-400" />
          <h1 className="mt-3 font-display text-2xl font-bold">Имейлът е потвърден</h1>
          <p className="mt-2 text-sm text-fg-2">Вече можеш да възстановиш паролата си, ако някога я забравиш.</p>
          <Link to="/" className="mt-6 inline-block">
            <Button>{signedIn ? 'Към играта' : 'Към входа'}</Button>
          </Link>
        </div>
      ) : (
        <div className="text-center">
          <XCircle className="mx-auto size-12 text-rose-400" />
          <h1 className="mt-3 font-display text-2xl font-bold">Не стана</h1>
          <p className="mt-2 text-sm text-fg-2">{state.error}</p>
          <Link to={signedIn ? '/settings' : '/'} className="mt-6 inline-block">
            <Button variant="secondary">{signedIn ? 'Към настройките' : 'Към входа'}</Button>
          </Link>
        </div>
      )}
    </Centered>
  );
}

// ─── /settings ───────────────────────────────────────────────────────────────

export function SettingsPage() {
  const me = useStore((s) => s.me)!;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Настройки</h1>
        <p className="mt-1 text-fg-2">
          Профил <b className="text-fg">{me.username}</b>
        </p>
      </div>
      <EmailSettings />
      <PasswordSettings />
      <DataSettings />
    </div>
  );
}

function DataSettings() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      socket.disconnect();
      setState({ me: null, room: null, game: null, queue: null });
      navigate('/', { replace: true });
      toast({ kind: 'info', title: 'Профилът е изтрит. Довиждане!' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нещо се обърка.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-violet-300" />
        <h2 className="font-display text-lg font-bold">Твоите данни</h2>
      </div>
      <p className="mt-1 text-sm text-fg-3">
        Виж как ги пазим в{' '}
        <Link to="/privacy" className="text-violet-300 hover:underline">
          Политиката за поверителност
        </Link>
        .
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href="/api/account/export" download="almanac-data.json">
          <Button variant="secondary" tabIndex={-1}>
            <Download className="size-4" /> Изтегли данните си
          </Button>
        </a>
        <Button variant="ghost" className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" /> Изтрий профила
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Изтриване на профила">
        <form onSubmit={remove} className="space-y-4">
          <p className="text-sm text-fg-2">
            Профилът, нивото, статистиката, постиженията и приятелите ти ще бъдат изтрити завинаги. Това не може да се отмени.
          </p>
          <label className="block">
            <Label>Потвърди с паролата си</Label>
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
          </label>
          {error && <p className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Отказ
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!password}>
              Изтрий завинаги
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

function EmailSettings() {
  const me = useStore((s) => s.me)!;
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | 'resend' | null>(null);

  async function save(address: string, kind: 'save' | 'resend') {
    setBusy(kind);
    try {
      const { user } = await api.setEmail(address);
      setState({ me: user });
      setEmail('');
      toast({ kind: 'success', icon: '✉️', title: 'Изпратихме линк за потвърждение', body: address });
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : 'Нещо се обърка.' });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    try {
      const { user } = await api.removeEmail();
      setState({ me: user });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <Mail className="size-5 text-violet-300" />
        <h2 className="font-display text-lg font-bold">Имейл</h2>
      </div>
      <p className="mt-1 text-sm text-fg-3">Използва се само за възстановяване на паролата. Не го показваме на никого.</p>

      {me.email && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
          <MailCheck className="size-5 text-emerald-300" />
          <span className="min-w-0 flex-1 truncate font-semibold">{me.email}</span>
          <span className="text-xs font-semibold text-emerald-300">Потвърден</span>
          <Button size="sm" variant="ghost" onClick={remove} loading={busy === 'remove'}>
            Премахни
          </Button>
        </div>
      )}
      {me.pendingEmail && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">
            Чака потвърждение: <b>{me.pendingEmail}</b>
            <span className="block text-xs text-fg-3">Отвори линка от писмото (провери и папката за спам).</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => save(me.pendingEmail!, 'resend')} loading={busy === 'resend'}>
            Изпрати отново
          </Button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(email.trim(), 'save');
        }}
        className="mt-4 flex flex-wrap gap-2"
      >
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          autoComplete="email"
          placeholder={me.email ? 'Нов имейл' : 'твоят@имейл.bg'}
          aria-label="Имейл"
          className={`${INPUT} min-w-0 flex-1`}
        />
        <Button type="submit" size="lg" loading={busy === 'save'}>
          {me.email ? 'Смени' : 'Добави'}
        </Button>
      </form>
    </Card>
  );
}

function PasswordSettings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 6) return setError('Новата парола трябва да е поне 6 символа.');
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      toast({ kind: 'success', title: 'Паролата е сменена', body: 'Другите устройства са отписани.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нещо се обърка.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-violet-300" />
        <h2 className="font-display text-lg font-bold">Парола</h2>
      </div>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <label className="block">
          <Label>Текуща парола</Label>
          <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
        </label>
        <label className="block">
          <Label>Нова парола</Label>
          <PasswordInput value={next} onChange={setNext} autoComplete="new-password" placeholder="поне 6 символа" />
        </label>
        {error && <p className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">{error}</p>}
        <Button type="submit" loading={busy}>
          Смени паролата
        </Button>
      </form>
    </Card>
  );
}
