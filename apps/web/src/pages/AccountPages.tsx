import { api, disconnectRealtime, refreshMe, setState, toast, useStore } from '@quiz/client';
import clsx from 'clsx';
import {
  Check,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Flame,
  KeyRound,
  LogOut,
  Mail,
  MailCheck,
  MailWarning,
  Save,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ClaimAccountModal } from '../components/ClaimAccount';
import { Logo } from '../components/NavBar';
import { Button, buttonClass, Card, Modal, Spinner } from '../components/ui';
import { markReturning } from '../lib/returning';
import { sfx, useMuted } from '../lib/sound';
import { usePageTitle } from '../lib/title';

const INPUT =
  'h-12 w-full rounded-2xl border border-line bg-black/30 px-4 text-[15px] outline-none placeholder:text-fg-3 focus:border-violet-400/60 focus:bg-black/40';

/** A labelled password input with a show/hide toggle (the label names the input alone, not the toggle). */
function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
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
          className="focus-ring absolute top-1/2 right-0.5 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-fg-3 hover:text-fg"
        >
          {show ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
        </button>
      </div>
    </div>
  );
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
// The forms here say `noValidate`: the browser's own bubbles speak the device's language (often English); the checks
// and the server's answers are shown in the form, in Bulgarian.

export function ResetPasswordPage() {
  usePageTitle('Нова парола');
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
        <form noValidate onSubmit={submit} className="mt-5 space-y-4">
          <PasswordField
            label="Нова парола"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder="поне 6 символа"
          />
          <PasswordField label="Повтори паролата" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {error && (
            <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
              {error}
            </p>
          )}
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
  usePageTitle('Потвърждение на имейла');
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
          <Link to="/" className={clsx('mt-6', buttonClass())}>
            {signedIn ? 'Към играта' : 'Към входа'}
          </Link>
        </div>
      ) : (
        <div className="text-center">
          <XCircle className="mx-auto size-12 text-rose-400" />
          <h1 className="mt-3 font-display text-2xl font-bold">Не стана</h1>
          <p className="mt-2 text-sm text-fg-2">{state.error}</p>
          <Link to={signedIn ? '/settings' : '/'} className={clsx('mt-6', buttonClass({ variant: 'secondary' }))}>
            {signedIn ? 'Към настройките' : 'Към входа'}
          </Link>
        </div>
      )}
    </Centered>
  );
}

// ─── /settings ───────────────────────────────────────────────────────────────

export function SettingsPage() {
  usePageTitle('Настройки');
  const me = useStore((s) => s.me)!;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold">Настройки</h1>
          <p className="mt-1 text-fg-2 [overflow-wrap:anywhere]">
            {me.isGuest ? 'Профил на гост' : 'Профил'} <b className="text-fg">{me.username}</b>
          </p>
        </div>
        <LogoutButton />
      </div>
      {/* A guest has no email or password yet: saving the account comes first, and brings both. */}
      {me.isGuest ? (
        <ClaimSettings />
      ) : (
        <>
          <EmailSettings />
          <ReminderSettings />
        </>
      )}
      <SoundSettings />
      {!me.isGuest && <PasswordSettings />}
      <DataSettings />
    </div>
  );
}

/** Forget the session on this device: back to the sign-in page with nothing of the old account left in memory. */
function clearSession() {
  disconnectRealtime();
  setState({ me: null, room: null, game: null, queue: null, invites: [] });
}

const EMAIL_INPUT_ID = 'settings-email';

/** Takes you to the email field (after a dialog that leads there has closed and handed focus back). */
function focusEmailField(delay = 0) {
  setTimeout(() => {
    const input = document.getElementById(EMAIL_INPUT_ID);
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
  }, delay);
}

function LogoutButton() {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await api.logout().catch(() => {});
    // Next time the sign-in page opens on "Вход" — unless this was a guest, who has nothing to sign in with.
    if (!me.isGuest) markReturning();
    clearSession();
    navigate('/', { replace: true });
  }

  function addEmail() {
    setOpen(false);
    focusEmailField(350);
  }

  if (me.isGuest) {
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <LogOut className="size-4" /> Изход
        </Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Изход от профила на гост">
          {/* No name or password to come back with: leaving is losing the account, so say it plainly. */}
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-rose-200">
              <TriangleAlert className="size-5 shrink-0" /> Профилът ще бъде изгубен
            </p>
            <p className="mt-2 text-fg-2">
              Играеш като гост, без име и парола — след изход няма как да влезеш отново в{' '}
              <b className="text-fg [overflow-wrap:anywhere]">{me.username}</b>. Нивото, серията и всичко изиграно се
              губят завинаги.
            </p>
          </div>
          <p className="mt-4 text-sm text-fg-2">Запази прогреса с име и парола — отнема 10 секунди.</p>
          {/* Saving leads; leaving anyway stays available but quiet. Phones stack them full width. */}
          <div className="mt-6 grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button
              onClick={() => {
                setOpen(false);
                setClaiming(true);
              }}
              className="sm:mr-auto"
            >
              <Save className="size-4" /> Запази прогреса
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Отказ
            </Button>
            <Button
              variant="ghost"
              className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
              onClick={logout}
              loading={busy}
            >
              <LogOut className="size-4" /> Излез без запазване
            </Button>
          </div>
        </Modal>
        <ClaimAccountModal open={claiming} onClose={() => setClaiming(false)} />
      </>
    );
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <LogOut className="size-4" /> Изход
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Изход от профила">
        {me.email ? (
          <p className="text-sm text-fg-2">Ще можеш да влезеш отново с потребителското име или имейла и паролата си.</p>
        ) : (
          // Without a verified email a forgotten password means the account is gone for good: say so before they leave.
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-amber-200">
              <MailWarning className="size-5 shrink-0" /> Профилът няма потвърден имейл
            </p>
            <p className="mt-2 text-fg-2">
              {me.pendingEmail ? (
                <>
                  Линкът за потвърждение до <b className="text-fg [overflow-wrap:anywhere]">{me.pendingEmail}</b> още не
                  е отворен.{' '}
                </>
              ) : null}
              Ако забравиш паролата, профилът не може да бъде възстановен. Запомни името{' '}
              <b className="text-fg [overflow-wrap:anywhere]">{me.username}</b> и паролата си — или първо добави имейл.
            </p>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {!me.email && !me.pendingEmail && (
            <Button variant="secondary" onClick={addEmail} className="mr-auto">
              <Mail className="size-4" /> Добави имейл
            </Button>
          )}
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Отказ
          </Button>
          <Button variant="danger" onClick={logout} loading={busy}>
            <LogOut className="size-4" /> Излез
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** An on/off setting: a card with a title, what it does, and a 44px switch named by the title. */
function SwitchCard({
  icon,
  title,
  hint,
  on,
  onToggle,
  disabled,
  busy,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: ReactNode;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** More about the setting under the hint (e.g. why it can't be switched on yet). */
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <Card className="p-6">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 [&>svg]:shrink-0">
            {icon}
            <h2 id={`${id}-label`} className="font-display text-lg font-bold">
              {title}
            </h2>
          </div>
          <p id={`${id}-hint`} className="mt-1 text-sm text-fg-3">
            {hint}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          aria-busy={busy || undefined}
          disabled={disabled || busy}
          onClick={onToggle}
          className={clsx(
            'focus-ring grid h-11 w-16 shrink-0 place-items-center rounded-2xl',
            disabled ? 'cursor-not-allowed opacity-45' : busy && 'cursor-progress',
          )}
        >
          <span
            aria-hidden
            className={clsx(
              'relative h-7 w-12 rounded-full border transition-colors',
              on ? 'border-violet-400/60 bg-violet-500/70' : 'border-line bg-white/10',
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 left-0.5 size-5.5 rounded-full bg-white shadow transition-transform',
                on && 'translate-x-5',
              )}
            />
          </span>
        </button>
      </div>
      {children}
    </Card>
  );
}

function SoundSettings() {
  const [muted, setMuted] = useMuted();
  const on = !muted;
  return (
    <SwitchCard
      icon={on ? <Volume2 className="size-5 text-violet-300" /> : <VolumeX className="size-5 text-fg-3" />}
      title="Звук"
      hint="Ефекти в играта: часовникът, верните и грешните отговори, наградите."
      on={on}
      onToggle={() => {
        setMuted(on);
        if (!on) sfx.pop(); // a taste of what was just switched on
      }}
    />
  );
}

/** The opt-in evening email when the daily streak is about to break (needs a verified address to go to). */
function ReminderSettings() {
  const me = useStore((s) => s.me)!;
  const [busy, setBusy] = useState(false);
  const on = me.streakReminders;
  // Switching off always works; switching on needs somewhere to send the email.
  const blocked = !on && !me.email;

  async function toggle() {
    setBusy(true);
    try {
      const { user } = await api.setReminders(!on);
      setState({ me: user });
      toast(
        user.streakReminders
          ? {
              kind: 'success',
              icon: '🔥',
              title: 'Напомнянето е включено',
              body: 'Ще ти пишем вечерта, ако серията ти е в опасност.',
            }
          : { kind: 'info', title: 'Напомнянето е изключено' },
      );
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : 'Нещо се обърка.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SwitchCard
      icon={<Flame className={clsx('size-5', on ? 'text-orange-300' : 'text-fg-3')} />}
      title="Напомняне за серията"
      hint={
        <>
          Имейл вечерта, ако серията ти от дневни предизвикателства ще изгори в полунощ, защото днешното още чака.
          Най-много едно писмо на ден; спираш го оттук или от линка във всяко писмо. Под 14 години — със съгласие на
          родител или настойник.
          {blocked && <span className="sr-only"> Нужен е потвърден имейл.</span>}
        </>
      }
      on={on}
      onToggle={toggle}
      disabled={blocked}
      busy={busy}
    >
      {blocked && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-black/20 px-4 py-3 text-sm">
          <MailWarning aria-hidden className="size-5 shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1 basis-48 text-fg-2">
            {me.pendingEmail ? (
              <>
                Отвори линка, който изпратихме до <b className="text-fg [overflow-wrap:anywhere]">{me.pendingEmail}</b>,
                и после включи напомнянето.
              </>
            ) : (
              'Нужен е потвърден имейл — добави го по-горе.'
            )}
          </span>
          {!me.pendingEmail && (
            <Button size="sm" variant="secondary" onClick={() => focusEmailField()}>
              <Mail className="size-4" /> Добави имейл
            </Button>
          )}
        </div>
      )}
    </SwitchCard>
  );
}

const CLAIM_PERKS = [
  'вход от всяко устройство',
  'приятели, свои стаи и предизвикателства',
  'с имейл: нова парола, ако я забравиш, и напомняне за серията',
];

/** Settings for a guest: saving the account (name, password, maybe email) instead of the email and password cards. */
function ClaimSettings() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-amber-300/25 bg-amber-400/[0.06] p-6">
      <div className="flex items-center gap-2">
        <Save className="size-5 text-amber-300" />
        <h2 className="font-display text-lg font-bold">Запази прогреса</h2>
      </div>
      <p className="mt-1 text-sm text-fg-2">
        Играеш като гост: профилът е само на това устройство. Ако излезеш или изчистиш данните на браузъра, нивото,
        серията и всичко изиграно се губят. С име и парола остават твои — и получаваш:
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-fg-2">
        {CLAIM_PERKS.map((perk) => (
          <li key={perk} className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-300" /> {perk}
          </li>
        ))}
      </ul>
      <Button className="mt-4 w-full sm:w-auto" onClick={() => setOpen(true)}>
        <Save className="size-4" /> Запази профила
      </Button>
      <ClaimAccountModal open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function DataSettings() {
  const guest = useStore((s) => !!s.me?.isGuest);
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
      // A guest has no password: being signed in on this device is the proof.
      await api.deleteAccount(guest ? '' : password);
      clearSession();
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
        <a href="/api/account/export" download="almanac-data.json" className={buttonClass({ variant: 'secondary' })}>
          <Download className="size-4" /> Изтегли данните си
        </a>
        <Button
          variant="ghost"
          className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-4" /> Изтрий профила
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Изтриване на профила">
        <form noValidate onSubmit={remove} className="space-y-4">
          <p className="text-sm text-fg-2">
            {guest
              ? 'Профилът на гост, нивото, статистиката и постиженията ти ще бъдат изтрити завинаги. Това не може да се отмени.'
              : 'Профилът, нивото, статистиката, постиженията и приятелите ти ще бъдат изтрити завинаги. Това не може да се отмени.'}
          </p>
          {!guest && (
            <PasswordField
              label="Потвърди с паролата си"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Отказ
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!guest && !password}>
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
  // Whoever controls the email can reset the password, so changing it asks for the password.
  const [password, setPassword] = useState('');
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | 'resend' | null>(null);

  async function save(address: string, kind: 'save' | 'resend') {
    setBusy(kind);
    try {
      const { user } = await api.setEmail(address, kind === 'save' ? password : undefined);
      setState({ me: user });
      setEmail('');
      setPassword('');
      toast({ kind: 'success', icon: '✉️', title: 'Изпратихме линк за потвърждение', body: address });
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : 'Нещо се обърка.' });
    } finally {
      setBusy(null);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy('remove');
    try {
      const { user } = await api.removeEmail(password);
      setState({ me: user });
      setPassword('');
      setRemoving(false);
      toast({ kind: 'info', title: 'Имейлът е премахнат' });
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : 'Нещо се обърка.' });
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
      <p className="mt-1 text-sm text-fg-3">
        За нова парола, ако забравиш старата, и за напомнянето за серията, ако го включиш. Не го показваме на никого.
      </p>

      {me.email && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
          <MailCheck className="size-5 text-emerald-300" />
          <span className="min-w-0 flex-1 truncate font-semibold">{me.email}</span>
          <span className="text-xs font-semibold text-emerald-300">Потвърден</span>
          {!removing && (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
              Премахни
            </Button>
          )}
        </div>
      )}
      {me.email && removing && (
        <form noValidate onSubmit={remove} className="mt-3 flex flex-wrap gap-2">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            autoComplete="current-password"
            placeholder="Парола за потвърждение"
            aria-label="Парола за потвърждение"
            className={`${INPUT} min-w-0 sm:flex-1`}
          />
          <Button type="submit" variant="danger" loading={busy === 'remove'}>
            Премахни имейла
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRemoving(false)}>
            Отказ
          </Button>
        </form>
      )}
      {me.pendingEmail && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">
            Чака потвърждение: <b>{me.pendingEmail}</b>
            <span className="block text-xs text-fg-3">Отвори линка от писмото (провери и папката за спам).</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => save(me.pendingEmail!, 'resend')}
            loading={busy === 'resend'}
          >
            Изпрати отново
          </Button>
        </div>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(email.trim(), 'save');
        }}
        className="mt-4 flex flex-wrap gap-2"
      >
        {/* Phones: one field per row; wider screens: side by side. */}
        <input
          id={EMAIL_INPUT_ID}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          autoComplete="email"
          placeholder={me.email ? 'Нов имейл' : 'твоят@имейл.bg'}
          aria-label="Имейл"
          className={`${INPUT} min-w-0 sm:flex-1`}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          autoComplete="current-password"
          placeholder="Парола за потвърждение"
          aria-label="Парола за потвърждение"
          className={`${INPUT} min-w-0 sm:flex-1`}
        />
        <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy === 'save'}>
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
      <form noValidate onSubmit={submit} className="mt-4 space-y-4">
        <PasswordField label="Текуща парола" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField
          label="Нова парола"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          placeholder="поне 6 символа"
        />
        {error && (
          <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
            {error}
          </p>
        )}
        <Button type="submit" loading={busy}>
          Смени паролата
        </Button>
      </form>
    </Card>
  );
}
