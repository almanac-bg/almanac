import { BRAND } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowLeft, DoorOpen, Eye, EyeOff, MailCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Logo } from '../components/NavBar';
import { Button, Card, Segmented } from '../components/ui';
import { api, setState } from '@quiz/client';
import { LegalLinks } from '../components/LegalLinks';
import { isReturning, markReturning } from '../lib/returning';

const FLOATERS = ['🦊', '🧠', '⚡', '🐼', '🏆', '🦄', '🔥', '🐙', '👑', '🎯'];

const FEATURES = [
  { icon: '⚔️', title: 'Дуели 1 на 1', body: 'Класирани битки в реално време' },
  { icon: '👑', title: 'Роял за 8', body: 'Елиминации до последния оцелял' },
  { icon: '🏆', title: 'Нива и постижения', body: 'Отключвай аватари, рамки и титли' },
];

/** On phones autofocus would pop the keyboard and scroll past the logo. */
const DESKTOP = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

const INPUT =
  'h-12 w-full rounded-2xl border border-line bg-black/30 px-4 text-[15px] outline-none placeholder:text-fg-3 focus:border-violet-400/60 focus:bg-black/40';

export function AuthPage() {
  // Signed out, every address shows this page — an invite link (/join/12345) included. Once signed in, the app opens the room.
  const { pathname } = useLocation();
  const inviteCode = /^\/join\/(\d+)\/?$/.exec(pathname)?.[1] ?? null;
  // Newcomers mostly arrive to sign up; a device that has signed in before most likely wants to sign in again.
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(() => (isReturning() ? 'login' : 'register'));
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
      const { user } =
        mode === 'login' ? await api.login(username, password) : await api.register(username, password, email.trim() || undefined);
      markReturning();
      setState({ me: user });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нещо се обърка.');
    } finally {
      setBusy(false);
    }
  }

  return (
    // Phones: brand, then the form (in reach without scrolling), then the pitch. Desktop: brand and pitch left, form right.
    <div className="relative mx-auto grid min-h-dvh max-w-6xl content-center gap-6 px-5 py-6 sm:gap-10 sm:py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-x-16">
      {/* floating avatars */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {FLOATERS.map((e, i) => (
          <span
            key={i}
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

      <motion.header
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
        className="relative @container min-w-0 lg:self-end"
      >
        {/* With an invite, phones skip the pitch: the hint says it all and the form stays on the first screen. */}
        <span
          className={clsx(
            'mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-3 py-1 text-xs font-semibold text-fg-2 sm:mb-6',
            inviteCode && 'max-sm:hidden',
          )}
        >
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Онлайн куиз битки
        </span>
        <h1 className="text-[min(12.5cqw,6.25rem)] leading-[0.9] whitespace-nowrap">
          <Logo />
        </h1>
        <p className="mt-3 font-display text-sm font-bold tracking-[0.35em] text-fg-3 uppercase">{BRAND.domain}</p>
        <p className={clsx('mt-4 max-w-md text-base text-fg-2 sm:mt-6 sm:text-xl', inviteCode && 'max-sm:hidden')}>
          Бързи въпроси. Истински съперници. <span className="text-fg">Кой е най-умният в стаята?</span>
        </p>
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 24 }}
        className="relative min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
      >
        <div className="absolute -inset-px rounded-[28px] bg-[linear-gradient(140deg,#a855f766,transparent_40%,#22d3ee55)] blur-sm" />
        <Card className="relative bg-ink-2/70 p-6 sm:p-8">
          {mode === 'forgot' ? (
            <ForgotPassword
              initial={username}
              onBack={() => {
                setMode('login');
                setError(null);
              }}
            />
          ) : (
          <>
          {inviteCode && (
            <p className="mb-5 flex items-start gap-3 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 p-3.5 text-sm text-fg-2">
              <DoorOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-fuchsia-300" />
              <span>
                Имаш покана за стая <b className="font-mono tracking-widest text-fg">{inviteCode}</b> —{' '}
                {mode === 'login' ? 'влез в профила си, за да се присъединиш.' : 'създай профил, за да влезеш.'}
              </span>
            </p>
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
          <h2 className="mt-6 font-display text-2xl font-bold">
            {mode === 'login' ? 'Здравей отново!' : 'Създай профил'}
          </h2>
          <p className="mt-1 text-sm text-fg-3">
            {mode === 'login' ? 'Влез и продължи там, където спря.' : 'Отнема 10 секунди. Пазим нивото и статистиката ти.'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label={mode === 'login' ? 'Потребителско име или имейл' : 'Потребителско име'}>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus={DESKTOP}
                required
                minLength={mode === 'register' ? 3 : 1}
                maxLength={mode === 'register' ? 20 : 254}
                placeholder="напр. Мозъчко"
                className={INPUT}
              />
            </Field>
            {mode === 'register' && (
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
            )}
            <Field label="Парола">
              <div className="relative">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={show ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                  placeholder={mode === 'register' ? 'поне 6 символа' : '••••••••'}
                  className="h-12 w-full rounded-2xl border border-line bg-black/30 px-4 pr-12 text-[15px] outline-none placeholder:text-fg-3 focus:border-violet-400/60 focus:bg-black/40"
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
              role="alert"
              className={clsx(
                'overflow-hidden rounded-xl bg-rose-500/10 text-sm text-rose-300 transition-all',
                error ? 'max-h-20 px-3 py-2.5' : 'max-h-0',
              )}
            >
              {error}
            </div>

            <Button type="submit" size="lg" className="w-full" loading={busy}>
              {mode === 'login' ? 'Влез' : 'Създай профил и играй'}
            </Button>
            {mode === 'register' && (
              <p className="text-center text-xs text-fg-3">
                Със създаването на профил приемаш{' '}
                <Link to="/terms" className="text-violet-300 hover:underline">
                  Условията за ползване
                </Link>{' '}
                и{' '}
                <Link to="/privacy" className="text-violet-300 hover:underline">
                  Политиката за поверителност
                </Link>
                .
              </p>
            )}
          </form>
          </>
          )}
        </Card>
        <LegalLinks className="mt-4 justify-center" />
      </motion.div>

      <ul className="relative grid gap-3 sm:grid-cols-3 lg:col-start-1 lg:row-start-2 lg:max-w-xl lg:self-start">
        {FEATURES.map((f, i) => (
          <motion.li
            key={f.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.1 }}
            className="glass flex items-center gap-3.5 rounded-2xl p-3.5 sm:block sm:p-4"
          >
            <div aria-hidden className="text-2xl">
              {f.icon}
            </div>
            <div>
              <div className="text-sm font-bold sm:mt-2">{f.title}</div>
              <div className="mt-0.5 text-xs text-fg-3">{f.body}</div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function ForgotPassword({ initial, onBack }: { initial: string; onBack: () => void }) {
  const [login, setLogin] = useState(initial);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(login.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нещо се обърка.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="focus-ring -my-2.5 inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-fg-3 hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Обратно към вход
      </button>
      <h2 className="mt-5 font-display text-2xl font-bold">Забравена парола</h2>
      {sent ? (
        <div className="mt-4 space-y-3 text-sm text-fg-2">
          <p className="rounded-2xl bg-emerald-500/10 p-4 text-emerald-200">
            <MailCheck className="mb-2 size-6" />
            Ако профилът има потвърден имейл, изпратихме линк за нова парола. Провери пощата си (и папката за спам). Линкът е валиден 1 час.
          </p>
          <p className="text-fg-3">Без потвърден имейл паролата не може да се възстанови — тогава създай нов профил.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4">
          <p className="text-sm text-fg-3">Въведи потребителското си име или имейла, който си потвърдил. Ще ти изпратим линк за нова парола.</p>
          <Field label="Потребителско име или имейл">
            <input value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus={DESKTOP} autoComplete="username" className={INPUT} />
          </Field>
          {error && <p className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Изпрати линк
          </Button>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-fg-2 uppercase">{label}</span>
      {children}
    </label>
  );
}
