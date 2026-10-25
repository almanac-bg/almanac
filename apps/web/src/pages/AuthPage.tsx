import { api, fmt, setState } from '@quiz/client';
import { BRAND, type ChallengePreview, MODES } from '@quiz/shared';
import clsx from 'clsx';
import {
  ArrowLeft,
  DoorOpen,
  Eye,
  EyeOff,
  LogIn,
  MailCheck,
  RotateCcw,
  Swords,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar';
import { LegalLinks, MINORS_NOTICE } from '../components/LegalLinks';
import { Logo } from '../components/NavBar';
import { Button, Card, Segmented, Spinner } from '../components/ui';
import { credentialsProblem } from '../lib/credentials';
import { type LoadFailure, useLoad } from '../lib/load';
import { isReturning, markReturning } from '../lib/returning';
import { usePageTitle } from '../lib/title';

const FLOATERS = ['🦊', '🧠', '⚡', '🐼', '🏆', '🦄', '🔥', '🐙', '👑', '🎯'];

const FEATURES = [
  { icon: '⚔️', title: 'Дуели 1 на 1', body: 'Класирани битки в реално време' },
  { icon: '👑', title: 'Роял за 8', body: 'Елиминации до последния оцелял' },
  { icon: '🏆', title: 'Нива и постижения', body: 'Отключвай аватари, рамки и титли' },
];

/** On phones autofocus would pop the keyboard and scroll past the logo. */
const DESKTOP = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

const INPUT =
  'h-12 w-full rounded-2xl border border-line bg-black/30 px-4 text-[15px] outline-none placeholder:text-fg-3 focus:border-violet-400/60 focus:bg-black/40 aria-invalid:border-rose-400/60';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Нещо се обърка.');

/** Where a new guest lands: the challenge page with "accept" pressed already, or the lobby. */
type GuestLanding = { to: string; state?: { accept: true } } | null;

export function AuthPage() {
  // Signed out, every address shows this page — an invite link (/join/12345) or a challenge link (/c/abc) included.
  // Once signed in, the app opens the room or the challenge.
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const inviteCode = /^\/join\/(\d+)\/?$/.exec(pathname)?.[1] ?? null;
  const challengeId = /^\/c\/([\w-]{1,16})\/?$/.exec(pathname)?.[1] ?? null;
  usePageTitle(challengeId ? 'Предизвикателство' : null);
  // Newcomers mostly arrive to play (or sign up); a device that has signed in before most likely wants to sign in again.
  const [returning] = useState(isReturning);
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(() => (returning ? 'login' : 'register'));
  // A challenge link opens on the challenge itself; "Имам профил — вход" swaps in the form.
  const [formOpen, setFormOpen] = useState(!challengeId);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The field the error is about (when the check here found it): marked while the message shows.
  const [invalid, setInvalid] = useState<'username' | 'password' | null>(null);
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const id = useId();
  const [guestError, setGuestError] = useState<string | null>(null);

  const preview = useLoad<ChallengePreview | null>(
    () => (challengeId ? api.challengePreview(challengeId) : Promise.resolve(null)),
    challengeId ?? '',
  );
  const playable = !!preview.data && !preview.data.expired;

  async function submit(e: FormEvent) {
    e.preventDefault();
    // The message goes in the box above the button (where the eyes are), the field gets marked and points to it.
    const problem = credentialsProblem(username, password, { newAccount: mode === 'register' });
    setInvalid(problem?.field ?? null);
    if (problem) return setError(problem.message);
    setError(null);
    setBusy(true);
    try {
      const { user } =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password, email.trim() || undefined);
      markReturning();
      setState({ me: user });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** "Играй като гост": an account without a name or password yet, one tap from the first question. */
  async function playAsGuest(landing: GuestLanding = null) {
    setGuestError(null);
    setGuestBusy(true);
    try {
      const { user } = await api.guest();
      // Same render as signing in, so the signed-in app opens straight on the right page.
      if (landing) navigate(landing.to, { replace: true, state: landing.state });
      setState({ me: user });
    } catch (err) {
      setGuestError(errorMessage(err));
      setGuestBusy(false);
    }
  }

  // A live challenge: the guest account opens it with "accept" pressed. A dead link: the lobby.
  const guestLanding: GuestLanding = challengeId
    ? playable
      ? { to: pathname, state: { accept: true } }
      : { to: '/' }
    : null;

  const guest = (
    <GuestPlay
      primary={!returning}
      label={inviteCode ? 'Влез като гост' : challengeId && playable ? 'Приеми като гост' : 'Играй като гост'}
      busy={guestBusy}
      error={guestError}
      onPlay={() => playAsGuest(guestLanding)}
    />
  );

  return (
    // Phones: brand, then the form (in reach without scrolling), then the pitch. Tablets and up: brand and pitch left,
    // form right.
    <div className="relative isolate mx-auto grid min-h-dvh max-w-6xl content-center gap-6 px-4 py-6 sm:gap-10 sm:px-5 sm:py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-x-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-x-16">
      <motion.header
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
        className="relative @container min-w-0 md:self-end"
      >
        {/* With an invite or a challenge, phones skip the pitch: the card says it all and stays on the first screen. */}
        <span
          className={clsx(
            'mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-3 py-1 text-xs font-semibold text-fg-2 sm:mb-6',
            (inviteCode || challengeId) && 'max-sm:hidden',
          )}
        >
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Онлайн куиз битки
        </span>
        <h1 className="text-[min(12.5cqw,6.25rem)] leading-[0.9] whitespace-nowrap">
          <Logo />
        </h1>
        <p className="mt-3 font-display text-sm font-bold tracking-[0.35em] text-fg-3 uppercase">{BRAND.domain}</p>
        <p
          className={clsx(
            'mt-4 max-w-md text-base text-fg-2 sm:mt-6 sm:text-xl',
            (inviteCode || challengeId) && 'max-sm:hidden',
          )}
        >
          Бързи въпроси. Истински съперници. <br className="max-sm:hidden" />
          <span className="text-fg">Кой знае най-много?</span>
        </p>
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 24 }}
        className="relative min-w-0 md:col-start-2 md:row-span-2 md:row-start-1"
      >
        {/* The glow hugs the card only (not the links under it) and never takes a click. */}
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-px rounded-[28px] bg-[linear-gradient(140deg,#a855f766,transparent_40%,#22d3ee55)] blur-sm"
          />
          {/* Nearly opaque: the floating emoji behind it would otherwise drift across the fields. */}
          <Card className="relative bg-ink-2/95 p-5 sm:p-8">
            {challengeId && !formOpen ? (
              <ChallengeLanding
                preview={preview.data}
                error={preview.error}
                onRetry={preview.retry}
                busy={guestBusy}
                guestError={guestError}
                onPlay={() => playAsGuest(guestLanding)}
                onSignIn={() => {
                  setFormOpen(true);
                  setMode('login');
                  setError(null);
                }}
              />
            ) : mode === 'forgot' ? (
              <ForgotPassword
                initial={username}
                onBack={() => {
                  setMode('login');
                  setError(null);
                }}
              />
            ) : (
              <>
                {challengeId && (
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    className="focus-ring -mt-2.5 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-fg-3 hover:text-fg"
                  >
                    <ArrowLeft className="size-4" /> Към предизвикателството
                  </button>
                )}
                {inviteCode && (
                  <p className="mb-5 flex items-start gap-3 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 p-3.5 text-sm text-fg-2">
                    <DoorOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-fuchsia-300" />
                    <span>
                      Имаш покана за стая <b className="font-mono tracking-widest text-fg">{inviteCode}</b> — влез като
                      гост или с профила си, за да се присъединиш.
                    </span>
                  </p>
                )}
                {/* One main action per screen: playing as a guest for a new device, signing in for a known one. */}
                {!returning && (
                  <>
                    {guest}
                    <Or>или с профил</Or>
                  </>
                )}
                <Segmented
                  value={mode}
                  onChange={(m) => {
                    setMode(m);
                    setError(null);
                  }}
                  options={[
                    { value: 'login', label: 'Вход' },
                    { value: 'register', label: 'Регистрация' },
                  ]}
                />
                <h2 className="mt-6 t-section">{mode === 'login' ? 'Здравей отново!' : 'Създай профил'}</h2>
                <p className="mt-1 text-sm text-fg-3">
                  {mode === 'login'
                    ? 'Влез и продължи там, където спря.'
                    : 'Отнема 10 секунди. Пазим нивото и статистиката ти.'}
                </p>
                <form onSubmit={submit} noValidate className="mt-6 space-y-4">
                  <Field
                    label={mode === 'login' ? 'Потребителско име или имейл' : 'Потребителско име'}
                    htmlFor={`${id}-username`}
                  >
                    <input
                      id={`${id}-username`}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      aria-invalid={!!error && invalid === 'username'}
                      aria-describedby={error && invalid === 'username' ? `${id}-error` : undefined}
                      // biome-ignore lint/a11y/noAutofocus: desktop only (DESKTOP): on a phone it would pop the keyboard
                      autoFocus={DESKTOP && returning}
                      required
                      minLength={mode === 'register' ? 3 : 1}
                      maxLength={mode === 'register' ? 20 : 254}
                      placeholder="напр. Мозъчко"
                      className={INPUT}
                    />
                  </Field>
                  {mode === 'register' && (
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
                  )}
                  <Field label="Парола" htmlFor={`${id}-password`}>
                    <div className="relative">
                      <input
                        id={`${id}-password`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type={show ? 'text' : 'password'}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        aria-invalid={!!error && invalid === 'password'}
                        aria-describedby={error && invalid === 'password' ? `${id}-error` : undefined}
                        required
                        minLength={6}
                        placeholder={mode === 'register' ? 'поне 6 символа' : '••••••••'}
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
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        setError(null);
                      }}
                      className="focus-ring -my-2.5 inline-flex min-h-11 items-center rounded text-sm font-semibold text-violet-300 hover:text-violet-200"
                    >
                      Забравена парола?
                    </button>
                  )}

                  <div
                    id={`${id}-error`}
                    role="alert"
                    className={clsx(
                      'overflow-hidden rounded-xl bg-rose-500/10 text-sm text-rose-300 transition-all',
                      error ? 'max-h-20 px-3 py-2.5' : 'max-h-0',
                    )}
                  >
                    {error}
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    variant={returning ? 'primary' : 'secondary'}
                    className="w-full"
                    loading={busy}
                  >
                    {mode === 'login' ? 'Влез' : 'Създай профил и играй'}
                  </Button>
                </form>
                {returning && (
                  <>
                    <Or>или</Or>
                    {guest}
                  </>
                )}
                <Consent minors={mode === 'register'} />
              </>
            )}
          </Card>
        </div>
      </motion.div>

      <ul className="relative grid gap-3 sm:grid-cols-3 md:col-start-1 md:row-start-2 md:grid-cols-1 md:self-start lg:max-w-xl lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <motion.li
            key={f.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.1 }}
            className="glass flex items-center gap-3.5 rounded-2xl p-3.5 sm:block sm:p-4 md:flex lg:block"
          >
            <div aria-hidden className="text-2xl">
              {f.icon}
            </div>
            <div>
              <div className="text-sm font-bold sm:mt-2 md:mt-0 lg:mt-2">{f.title}</div>
              <div className="mt-0.5 text-xs text-fg-3">{f.body}</div>
            </div>
          </motion.li>
        ))}
      </ul>

      {/* After the pitch on phones; under the card from tablets up. */}
      <LegalLinks className="justify-center md:col-start-2 md:row-start-3" />
      {/* Floating avatars: last in the page, so search engines don't take them for its opening words. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        {FLOATERS.map((e, i) => (
          <span
            key={e}
            className="absolute animate-float text-3xl opacity-25 blur-[0.5px] sm:text-4xl"
            style={{
              left: `${(i * 37) % 95}%`,
              top: `${(i * 53 + 7) % 90}%`,
              animationDelay: `${-i * 0.9}s`,
              animationDuration: `${5 + (i % 4)}s`,
            }}
          >
            {e}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Playing as a guest also accepts the terms, so the line sits under every way in; under signing up, the age note too. */
function Consent({ minors }: { minors?: boolean }) {
  return (
    <div className="mt-5 space-y-1.5 text-center text-xs text-fg-3">
      <p>
        Като играеш, приемаш{' '}
        <Link to="/terms" className="text-violet-300 hover:underline">
          Условията за ползване
        </Link>{' '}
        и{' '}
        <Link to="/privacy" className="text-violet-300 hover:underline">
          Политиката за поверителност
        </Link>
        .
      </p>
      {minors && <p>{MINORS_NOTICE}</p>}
    </div>
  );
}

function Or({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs font-semibold tracking-wide text-fg-3 uppercase">
      <span aria-hidden className="h-px flex-1 bg-line" />
      {children}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

function GuestPlay({
  primary,
  label,
  busy,
  error,
  onPlay,
}: {
  primary: boolean;
  label: string;
  busy: boolean;
  error: string | null;
  onPlay: () => void;
}) {
  return (
    <div>
      <Button size="lg" variant={primary ? 'primary' : 'secondary'} className="w-full" loading={busy} onClick={onPlay}>
        <Zap aria-hidden className="size-5" /> {label}
      </Button>
      <p className="mt-2.5 text-center text-sm text-fg-3">
        Без регистрация. Нивото и серията се пазят — запазваш профила с име и парола, когато решиш.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

/** A challenge link opened signed out: who's challenging, the score to beat, and one tap to play it as a guest. */
function ChallengeLanding({
  preview,
  error,
  onRetry,
  busy,
  guestError,
  onPlay,
  onSignIn,
}: {
  preview: ChallengePreview | null;
  error: LoadFailure | null;
  onRetry: () => void;
  busy: boolean;
  guestError: string | null;
  onPlay: () => void;
  onSignIn: () => void;
}) {
  const mode = MODES.challenge;
  const missing = error?.status === 404;

  // Not LoadError: signed out there's no realtime connection, so it would always read as "offline, retrying by itself".
  if (error && !missing) {
    return (
      <div role="alert" className="grid place-items-center gap-3 py-10 text-center">
        <TriangleAlert aria-hidden className="size-8 text-rose-300" />
        <p className="t-card">Предизвикателството не се зареди</p>
        <p className="max-w-xs text-sm text-fg-3">{error.message}</p>
        <Button variant="secondary" className="mt-1" onClick={onRetry}>
          <RotateCcw aria-hidden className="size-4" /> Опитай пак
        </Button>
      </div>
    );
  }
  if (!preview && !missing) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }

  const signIn = (
    <button
      type="button"
      onClick={onSignIn}
      className="focus-ring mx-auto mt-3 flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-violet-300 hover:text-violet-200"
    >
      <LogIn aria-hidden className="size-4" /> Имам профил — вход
    </button>
  );
  const failure = guestError && (
    <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
      {guestError}
    </p>
  );

  if (missing || !preview) {
    return (
      <div className="text-center">
        <span aria-hidden className="text-5xl">
          🔗
        </span>
        <h2 className="mt-3 t-section">Линкът не работи</h2>
        <p className="mt-2 text-sm text-fg-3">
          Няма такова предизвикателство — линкът може да е непълен или вече изтрит. Можеш да играеш и без него.
        </p>
        <Button size="lg" className="mt-6 w-full" loading={busy} onClick={onPlay}>
          <Zap aria-hidden className="size-5" /> Играй като гост
        </Button>
        {failure}
        {signIn}
        <Consent />
      </div>
    );
  }

  const { creator, topScore, players, expired } = preview;
  return (
    <div>
      <p className="flex items-center gap-1.5 t-eyebrow" style={{ color: mode.accent[0] }}>
        <Swords aria-hidden className="size-3.5" /> Предизвикателство
        {expired && (
          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-fg-2 normal-case">
            Изтекло
          </span>
        )}
      </p>
      {/* On the narrowest phones the title goes under the avatar rather than breaking a word. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        {creator && <Avatar avatar={creator.avatar} frame={creator.frame} size={64} />}
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="font-display text-[1.375rem] leading-tight font-bold [overflow-wrap:anywhere] sm:text-2xl">
            {creator ? (
              <>
                {creator.username} <span className="text-fg-2">те предизвиква</span>
              </>
            ) : (
              'Покажи какво знаеш'
            )}
          </h2>
          <p className="mt-1 text-sm text-fg-3">
            {mode.questions} въпроса · {mode.timeMs / 1000} секунди за всеки · един опит
          </p>
        </div>
      </div>

      {players > 0 ? (
        // The score gets the room: a four-digit number in the display font is wide.
        <dl className="mt-5 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
          <Stat label={expired ? 'Най-добър резултат' : 'Резултат за биене'} value={`${fmt(topScore ?? 0)} т.`} />
          <Stat label="Изиграха го" value={fmt(players)} />
        </dl>
      ) : (
        <p className="mt-5 rounded-2xl border border-line bg-black/20 p-4 text-sm text-fg-2">
          {expired ? 'Никой не го изигра навреме.' : 'Още никой не го е изиграл. Постави първия резултат!'}
        </p>
      )}

      {expired ? (
        <>
          <p className="mt-5 text-sm text-fg-2">
            Предизвикателството изтече и вече не може да се играе. Влез в играта — дуелите и дневното предизвикателство
            те чакат.
          </p>
          <Button size="lg" className="mt-5 w-full" loading={busy} onClick={onPlay}>
            <Zap aria-hidden className="size-5" /> Играй като гост
          </Button>
        </>
      ) : (
        <>
          <Button size="lg" className="mt-6 h-auto min-h-14 w-full py-2 text-balance" loading={busy} onClick={onPlay}>
            <Swords aria-hidden className="size-5 max-sm:hidden" /> Приеми предизвикателството
          </Button>
          <p className="mt-2.5 text-center text-sm text-fg-3">
            Играеш веднага като гост, без регистрация. Прогресът се пази — запазваш профила с име и парола, когато
            решиш.
          </p>
        </>
      )}
      {failure}
      {signIn}
      <Consent />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-black/20 p-3.5">
      <dt className="text-[11px] font-semibold tracking-wide text-fg-3 uppercase">{label}</dt>
      <dd className="mt-1 font-display text-xl font-bold whitespace-nowrap tabular-nums sm:text-2xl">{value}</dd>
    </div>
  );
}

function ForgotPassword({ initial, onBack }: { initial: string; onBack: () => void }) {
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

/** A label above its input, tied to it by id: wrapping both would add the show-password toggle to the input's name. */
function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}
