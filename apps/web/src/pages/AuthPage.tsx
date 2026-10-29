import { api, errorMessage, fmt, plural, setState } from '@quiz/client';
import {
  BRAND,
  CATEGORIES,
  type ChallengePreview,
  type DailyPreview,
  type GroupPreview,
  isQueueMode,
  MODES,
  type ModeId,
  PASSWORD_MIN_LENGTH,
  RANK_TIERS,
} from '@quiz/shared';
import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  DoorOpen,
  Eye,
  EyeOff,
  LogIn,
  MailCheck,
  RotateCcw,
  Swords,
  TriangleAlert,
  UsersRound,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Emoji } from '../components/Emoji';
import { LegalLinks, MINORS_NOTICE } from '../components/LegalLinks';
import { Logo } from '../components/NavBar';
import { Button, Card, Field, INPUT, Segmented, Spinner } from '../components/ui';
import { type CredentialField, credentialsProblems } from '../lib/credentials';
import { type LoadFailure, useLoad } from '../lib/load';
import { isPainted, paintedReturning } from '../lib/painted';
import { isReturning, markReturning } from '../lib/returning';
import { useSite } from '../lib/site';
import { usePageTitle } from '../lib/title';

// What works with nobody else online comes first: the day's questions (everyone's the same) and a link to a friend.
const FEATURES = [
  { icon: '🗓️', title: 'Въпросите на деня', body: 'Едни и същи 10 за цяла България, класиране до полунощ' },
  { icon: '🔗', title: 'Предизвикай приятел', body: 'Пращаш линк, играе същите въпроси, когато може' },
  { icon: '⚔️', title: 'Дуели и Роял', body: 'Битки в реално време, до 8 играчи' },
];

/** The modes the page below the first screen describes, in the order a newcomer meets them. */
const ABOUT_MODES: ModeId[] = ['daily', 'challenge', 'duel', 'royale', 'solo', 'custom'];

/** On phones autofocus would pop the keyboard and scroll past the logo. */
const DESKTOP = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

/** Where a new guest lands: the challenge page with "accept" pressed already, the day's questions playing, or the lobby. */
type GuestLanding = { to: string; state?: { accept: true } | { play: true } } | null;

export function AuthPage() {
  // Signed out, every address shows this page — an invite link (/join/123456) or a challenge link (/c/abc) included.
  // Once signed in, the app opens the room or the challenge.
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const roomCode = /^\/join\/(\d+)\/?$/.exec(pathname)?.[1] ?? null;
  // A group's invite link (/groups/join/<code>): joined once signed in (or as a guest).
  const groupCode = /^\/groups\/join\/([\w-]{1,16})\/?$/.exec(pathname)?.[1] ?? null;
  // Either invite opens on the form, with what it's for above it.
  const inviteCode = roomCode ?? groupCode;
  const challengeId = /^\/c\/([\w-]{1,16})\/?$/.exec(pathname)?.[1] ?? null;
  // The day's questions (/daily), or someone's link to them (/daily/<code>).
  const daily = /^\/daily(?:\/([\w-]{1,16}))?\/?$/.exec(pathname);
  const dailyCode = daily?.[1] ?? null;
  // A challenge or daily link's page comes with its own title from the server: "Мария те предизвиква в АЛМАНАХ".
  usePageTitle(challengeId || daily ? undefined : null);
  // Newcomers mostly arrive to play (or sign up); a device that has signed in before most likely wants to sign in again.
  // A page the server drew is hydrated as drawn: its first render takes the version the server chose.
  const drawn = isPainted();
  const [returning] = useState(() => (drawn ? paintedReturning() : isReturning()));
  // A returning device on a computer types its name at once (a phone's keyboard would cover the page). Focused by an
  // effect rather than autoFocus, so the server's markup and the first render stay the same.
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival
  useEffect(() => {
    if (DESKTOP && returning) usernameRef.current?.focus();
  }, []);
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(() => (returning ? 'login' : 'register'));
  // A challenge or daily link opens on what it's for, and a new visitor on the day's questions: "Вход" swaps in the
  // form. An invite, or a device that has signed in before, opens on the form.
  const [formOpen, setFormOpen] = useState(() => !challengeId && !daily && (returning || !!inviteCode));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The field the error is about (when the check here found it): marked while the message shows.
  const [invalid, setInvalid] = useState<CredentialField[]>([]);
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const id = useId();
  const [guestError, setGuestError] = useState<string | null>(null);

  const preview = useLoad<ChallengePreview | null>(
    () => (challengeId ? api.challengePreview(challengeId) : Promise.resolve(null)),
    challengeId ?? '',
  );
  const playable = !!preview.data && !preview.data.expired;
  const group = useLoad<GroupPreview | null>(
    () => (groupCode ? api.groupPreview(groupCode) : Promise.resolve(null)),
    groupCode ?? '',
  );
  const dailyPreview = useLoad<DailyPreview | null>(
    () => (daily ? api.dailyPreview(dailyCode ?? undefined) : Promise.resolve(null)),
    daily ? (dailyCode ?? '/') : '',
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    // The message goes in the box above the button (where the eyes are), the field gets marked and points to it.
    // Everything wrong at once, and the first field to fix gets the focus.
    const problems = credentialsProblems(username, password, { newAccount: mode === 'register' });
    setInvalid(problems.map((p) => p.field));
    if (problems.length) {
      (problems[0].field === 'username' ? usernameRef : passwordRef).current?.focus();
      return setError(problems.map((p) => p.message).join(' '));
    }
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

  // A live challenge: the guest account opens it with "accept" pressed. A dead link: the lobby. The day's questions:
  // playing.
  const guestLanding: GuestLanding = challengeId
    ? playable
      ? { to: pathname, state: { accept: true } }
      : { to: '/' }
    : daily
      ? { to: pathname, state: { play: true } }
      : null;
  const openForm = (m: 'login' | 'register') => {
    setFormOpen(true);
    setMode(m);
    setError(null);
  };

  const guest = (
    <GuestPlay
      // On the sign-in tab, signing in is what's asked for: the guest button steps back.
      primary={!returning && mode !== 'login'}
      label={inviteCode ? 'Влез като гост' : challengeId && playable ? 'Приеми като гост' : 'Играй като гост'}
      busy={guestBusy}
      error={guestError}
      onPlay={() => playAsGuest(guestLanding)}
    />
  );

  // The plain landing page tells more below the first screen; an invite or a link keeps to its card.
  const about = !inviteCode && !challengeId && !daily;
  const linked = !!inviteCode || !!challengeId || !!daily;
  const playDaily = () => playAsGuest({ to: '/daily', state: { play: true } });

  return (
    <>
      {/* Phones: brand, then the form (in reach without scrolling), then the pitch. Tablets and up: brand and pitch
        left, form right. */}
      <div className="relative isolate mx-auto grid min-h-dvh max-w-6xl content-center gap-6 px-4 py-6 sm:gap-10 sm:px-5 sm:py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-x-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-x-16">
        <motion.header
          initial={drawn ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
          className="relative @container min-w-0 md:self-end"
        >
          {/* With an invite or a challenge, phones skip the pitch: the card says it all and stays on the first screen. */}
          <span
            className={clsx(
              'mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-tint/5 px-3 py-1 text-xs font-semibold text-fg-2 sm:mb-6',
              linked && 'max-sm:hidden',
            )}
          >
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Нови 10 въпроса всеки ден
          </span>
          <h1 className="text-[min(12.5cqw,6.25rem)] leading-[0.9] whitespace-nowrap">
            <Logo />
            {/* What the name is, for screen readers and search results: the logo alone says only "АЛМАНАХ". */}
            <span className="sr-only"> — онлайн викторина на български: 10 въпроса на деня</span>
          </h1>
          <p className="mt-3 font-display text-sm font-bold tracking-[0.35em] text-fg-3 uppercase">{BRAND.domain}</p>
          <p className={clsx('mt-4 max-w-md text-base text-fg-2 sm:mt-6 sm:text-xl', linked && 'max-sm:hidden')}>
            10 въпроса на деня — едни и същи за цяла България. Три минути, една класация.{' '}
            <br className="max-sm:hidden" />
            <span className="text-fg">Кой знае най-много?</span>
          </p>
          <ProofLine className={clsx('mt-3', linked && 'max-sm:hidden')} />
        </motion.header>

        <motion.div
          initial={drawn ? false : { opacity: 0, y: 30, scale: 0.97 }}
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
              {daily && !formOpen ? (
                <DailyLanding
                  preview={dailyPreview.data}
                  busy={guestBusy}
                  guestError={guestError}
                  onPlay={() => playAsGuest(guestLanding)}
                  onSignIn={() => openForm('login')}
                />
              ) : !linked && !formOpen ? (
                <NewcomerStart
                  busy={guestBusy}
                  error={guestError}
                  onDaily={playDaily}
                  onGuest={() => playAsGuest(null)}
                  onForm={openForm}
                />
              ) : challengeId && !formOpen ? (
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
                  {(challengeId || daily || (!inviteCode && !returning)) && (
                    <button
                      type="button"
                      onClick={() => setFormOpen(false)}
                      className="focus-ring -mt-2.5 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-fg-3 hover:text-fg"
                    >
                      <ArrowLeft className="size-4" />{' '}
                      {challengeId ? 'Към предизвикателството' : daily ? 'Към въпросите на деня' : 'Назад'}
                    </button>
                  )}
                  {roomCode && (
                    <p className="mb-5 flex items-start gap-3 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 p-3.5 text-sm text-fg-2">
                      <DoorOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-fuchsia-300" />
                      <span>
                        Имаш покана за стая <b className="font-mono tracking-widest text-fg">{roomCode}</b> — влез като
                        гост или с профила си, за да се присъединиш.
                      </span>
                    </p>
                  )}
                  {groupCode && (
                    <p className="mb-5 flex items-start gap-3 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 p-3.5 text-sm text-fg-2">
                      <UsersRound aria-hidden className="mt-0.5 size-5 shrink-0 text-fuchsia-300" />
                      <span>
                        {group.data ? (
                          <>
                            Имаш покана за групата <b className="text-fg">„{group.data.name}“</b> (
                            {plural(group.data.members, 'член', 'членове')}): седмична класация на въпросите на деня.
                          </>
                        ) : group.error ? (
                          'Тази покана за група вече не е валидна — поискай нов линк.'
                        ) : (
                          'Имаш покана за група: седмична класация на въпросите на деня.'
                        )}{' '}
                        Влез като гост или с профила си, за да се присъединиш.
                      </span>
                    </p>
                  )}
                  {/* One main action per screen: playing as a guest for an invite, signing in for a known device. */}
                  {!returning && inviteCode && (
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
                        aria-invalid={!!error && invalid.includes('username')}
                        aria-describedby={error && invalid.includes('username') ? `${id}-error` : undefined}
                        ref={usernameRef}
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
                          aria-invalid={!!error && invalid.includes('password')}
                          aria-describedby={error && invalid.includes('password') ? `${id}-error` : undefined}
                          ref={passwordRef}
                          required
                          minLength={PASSWORD_MIN_LENGTH}
                          placeholder={mode === 'register' ? `поне ${PASSWORD_MIN_LENGTH} символа` : '••••••••'}
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
                      variant={returning || mode === 'login' ? 'primary' : 'secondary'}
                      className="w-full"
                      loading={busy}
                    >
                      {mode === 'login' ? 'Влез' : 'Създай профил и играй'}
                    </Button>
                  </form>
                  {(returning || (!inviteCode && !challengeId && !daily)) && (
                    <>
                      <Or>или</Or>
                      {guest}
                    </>
                  )}
                  <Consent />
                </>
              )}
            </Card>
          </div>
        </motion.div>

        <ul className="relative grid gap-3 sm:grid-cols-3 md:col-start-1 md:row-start-2 md:grid-cols-1 md:self-start lg:max-w-xl lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.li
              key={f.title}
              initial={drawn ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.1 }}
              // Nearly opaque, like the card above: the floating emoji would otherwise show through over the text.
              className="glass flex items-center gap-3.5 rounded-2xl bg-ink-2/90 p-3.5 sm:block sm:p-4 md:flex lg:block"
            >
              <div aria-hidden className="text-2xl">
                <Emoji e={f.icon} />
              </div>
              <div>
                <div className="text-sm font-bold sm:mt-2 md:mt-0 lg:mt-2">{f.title}</div>
                <div className="mt-0.5 text-xs text-fg-3">{f.body}</div>
              </div>
            </motion.li>
          ))}
        </ul>

        {/* After the pitch on phones; under the card from tablets up. With more below, at the bottom of the page. */}
        {!about && <LegalLinks className="justify-center md:col-start-2 md:row-start-3" />}
      </div>
      {about && (
        <AboutGame
          cta={
            returning ? null : (
              <Button size="lg" variant="gold" className="w-full" loading={guestBusy} onClick={playDaily}>
                Играй въпросите на деня <ArrowRight aria-hidden className="size-5" />
              </Button>
            )
          }
        />
      )}
    </>
  );
}

const WHY: { icon: string; title: string; text: string }[] = [
  {
    icon: '✅',
    title: 'Проверени въпроси',
    text: 'Всеки въпрос е проверен по източник. Видиш ли грешка, сигнализираш от прегледа след мача — и я поправяме.',
  },
  {
    icon: '💡',
    title: 'Научаваш по нещо всеки ден',
    text: 'След отговора — „Знаеше ли?“ с факт за него. Всичко научено се събира в „Моят алманах“.',
  },
  {
    icon: '🫂',
    title: 'С приятели и с цяла България',
    text: 'Една класация за въпросите на деня, дуели по линк, групи със седмична класация и Роял всяка вечер.',
  },
  {
    icon: '🛡️',
    title: 'Без реклами и проследяване',
    text: 'Безплатно, без реклами и без проследяващи бисквитки. Кодът на играта е отворен.',
  },
];

/** „Защо АЛМАНАХ“: what sets it apart, in four lines, after how it's played. */
function WhyAlmanac() {
  const id = useId();
  return (
    <div className="mt-12">
      {/* One string: the drawn page holds it whole (no marker between the parts). */}
      <p className="t-eyebrow text-violet-300">{`Защо ${BRAND.name}`}</p>
      <h2 id={id} className="mt-2 t-section text-balance">
        Игра, след която знаеш повече
      </h2>
      <ul aria-labelledby={id} className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {WHY.map((w) => (
          <li key={w.title} className="glass rounded-2xl p-5">
            <Emoji e={w.icon} className="size-8" size="" />
            <h3 className="mt-3 t-card">{w.title}</h3>
            <p className="mt-1.5 text-sm text-fg-3">{w.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The game in numbers, under the slogan: how many questions, and what it costs (nothing). */
function ProofLine({ className }: { className?: string }) {
  const questions = useSite()?.questions;
  // One string: the drawn page holds the sentence whole (no markers between its parts).
  const line = `${questions ? `Над ${fmt(questions)} въпроса, проверени по източници` : 'Въпроси, проверени по източници'} · ${CATEGORIES.length} категории · безплатно · без реклами`;
  return <p className={clsx('text-sm text-fg-3', className)}>{line}</p>;
}

/**
 * Below the first screen: the game in words, for a newcomer who scrolls before trying and for search engines (the
 * first screen alone is a logo, a slogan and a form).
 */
function AboutGame({ cta }: { cta: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mx-auto max-w-6xl px-4 pt-10 pb-6 sm:px-5 sm:pt-16">
      <p className="t-eyebrow text-violet-300">Как се играе</p>
      <h2 id={id} className="mt-2 t-section text-balance sm:text-3xl">
        Онлайн викторина с приятели и цяла България
      </h2>
      <p className="mt-3 max-w-2xl text-fg-2 sm:text-lg">
        Всеки въпрос е с четири отговора и часовник: верният носи точки, а бързият — още повече. Играеш в браузъра, на
        телефона или на компютъра. Без изтегляне, без реклами, безплатно.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ABOUT_MODES.map((modeId) => {
          const m = MODES[modeId];
          return (
            <li key={modeId} className="glass rounded-2xl p-5">
              <div
                aria-hidden
                className="h-1 w-10 rounded-full"
                style={{ background: `linear-gradient(90deg, ${m.accent[0]}, ${m.accent[1]})` }}
              />
              <h3 className="mt-4 flex flex-wrap items-baseline gap-x-2 t-card">
                {m.name} {isQueueMode(modeId) && <span className="t-eyebrow text-fg-3">{m.short}</span>}
              </h3>
              <p className="mt-1.5 text-sm font-semibold text-fg">{m.tagline}</p>
              <p className="mt-1 text-sm text-fg-3">{m.description}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-10 grid gap-x-16 gap-y-10 lg:grid-cols-2">
        <div>
          <h3 className="t-card">{CATEGORIES.length} категории въпроси</h3>
          <p className="mt-1.5 text-sm text-fg-3">Избираш категория в „Соло“ или играеш микс от всички.</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <li key={c.id} className="rounded-full border border-line bg-tint/5 px-3 py-1.5 text-sm text-fg-2">
                <Emoji e={c.icon} /> {c.name}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="t-card">Нива, ранг и колекция</h3>
          <p className="mt-1.5 text-sm text-fg-2">
            Всеки мач носи XP: качваш нива, пазиш серията си с въпросите на деня и отключваш аватари, рамки и титли.
            Класираните мачове местят рейтинга ти, а с него и ранга — от {RANK_TIERS[0].name} до{' '}
            {RANK_TIERS.at(-1)?.name}.
          </p>
          {cta && <div className="mt-6 max-w-sm">{cta}</div>}
        </div>
      </div>

      <WhyAlmanac />

      <LegalLinks className="mt-12 justify-center border-t border-line pt-2" />
    </section>
  );
}

/** Playing as a guest also accepts the terms, so the line (and the age note) sits under every way in. */
function Consent() {
  return (
    <div className="mt-5 space-y-1.5 text-center text-xs text-fg-3">
      <p>
        Като играеш, приемаш{' '}
        <Link to="/terms" className="text-violet-300 hover:underline">
          Условията за ползване
        </Link>
        . Как пазим данните ти — в{' '}
        <Link to="/privacy" className="text-violet-300 hover:underline">
          Политиката за поверителност
        </Link>
        .
      </p>
      <p>{MINORS_NOTICE}</p>
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

/**
 * A new visitor's first screen: the day's questions, one tap away (a guest account, and the questions are on). The
 * lobby as a guest, or a profile, are the other ways in.
 */
function NewcomerStart({
  busy,
  error,
  onDaily,
  onGuest,
  onForm,
}: {
  busy: boolean;
  error: string | null;
  onDaily: () => void;
  onGuest: () => void;
  onForm: (mode: 'login' | 'register') => void;
}) {
  const mode = MODES.daily;
  return (
    <div>
      <p className="flex items-center gap-1.5 t-eyebrow" style={{ color: mode.accent[0] }}>
        <CalendarDays aria-hidden className="size-3.5" /> {mode.name}
      </p>
      <h2 className="mt-2 t-section">10 въпроса, едни и същи за цяла България</h2>
      <p className="mt-1.5 text-sm text-fg-3">Около три минути, един опит до полунощ. Без регистрация.</p>
      <Button size="lg" variant="gold" className="mt-5 w-full" loading={busy} onClick={onDaily}>
        Играй въпросите на деня <ArrowRight aria-hidden className="size-5" />
      </Button>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
          {error}
        </p>
      )}
      <Or>или</Or>
      <Button size="lg" variant="secondary" className="w-full" disabled={busy} onClick={onGuest}>
        <Zap aria-hidden className="size-5" /> Играй като гост
      </Button>
      <p className="mt-2.5 text-center text-sm text-fg-3">Дуели, Роял, Соло — прогресът се пази и без профил.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-x-1 text-sm">
        <button
          type="button"
          onClick={() => onForm('login')}
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-semibold text-violet-300 hover:text-violet-200"
        >
          <LogIn aria-hidden className="size-4" /> Имам профил — вход
        </button>
        <button
          type="button"
          onClick={() => onForm('register')}
          className="focus-ring inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-violet-300 hover:text-violet-200"
        >
          Създай профил
        </button>
      </div>
      <Consent />
    </div>
  );
}

/** The day's questions opened signed out (/daily), or someone's link to them: their result to beat, and one tap. */
function DailyLanding({
  preview,
  busy,
  guestError,
  onPlay,
  onSignIn,
}: {
  preview: DailyPreview | null;
  busy: boolean;
  guestError: string | null;
  onPlay: () => void;
  onSignIn: () => void;
}) {
  const mode = MODES.daily;
  if (!preview) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="size-8 text-amber-300" />
      </div>
    );
  }
  const { sharer, number, players } = preview;
  return (
    <div>
      <p className="flex items-center gap-1.5 t-eyebrow" style={{ color: mode.accent[0] }}>
        <CalendarDays aria-hidden className="size-3.5" /> {mode.name} №{number}
      </p>
      {sharer ? (
        <>
          <div className="mt-4 flex items-center gap-3">
            <Avatar avatar={sharer.user.avatar} frame={sharer.user.frame} size={52} />
            <div className="min-w-0">
              {/* A long name wraps rather than losing "те кани" to an ellipsis. */}
              <h2 className="t-section text-balance [overflow-wrap:anywhere]">{sharer.user.username} те кани</h2>
              <p className="text-sm text-fg-2 tabular-nums">
                {sharer.correct}/{mode.questions} · {fmt(sharer.score)} т. — можеш ли повече?
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-fg-3">Същите {mode.questions} въпроса, един опит. Без регистрация.</p>
        </>
      ) : (
        <>
          <h2 className="mt-2 t-section">10 въпроса, едни и същи за цяла България</h2>
          <p className="mt-1.5 text-sm text-fg-3">
            Около три минути, един опит до полунощ. Без регистрация
            {players > 0 ? ` · днес вече играха ${players === 1 ? '1 човек' : `${fmt(players)} души`}` : ''}.
          </p>
        </>
      )}
      <Button size="lg" variant="gold" className="mt-6 w-full" loading={busy} onClick={onPlay}>
        Играй <ArrowRight aria-hidden className="size-5" />
      </Button>
      {guestError && (
        <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
          {guestError}
        </p>
      )}
      <button
        type="button"
        onClick={onSignIn}
        className="focus-ring mx-auto mt-3 flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-violet-300 hover:text-violet-200"
      >
        <LogIn aria-hidden className="size-4" /> Имам профил — вход
      </button>
      <Consent />
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
          <Emoji e="🔗" />
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
          <span className="ml-auto rounded-full bg-tint/10 px-2 py-0.5 text-xs text-fg-2 normal-case">Изтекло</span>
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
        <p className="mt-5 rounded-2xl border border-line bg-sunk/20 p-4 text-sm text-fg-2">
          {expired ? 'Никой не го изигра навреме.' : 'Още никой не го е изиграл. Постави първия резултат!'}
        </p>
      )}

      {expired ? (
        <>
          <p className="mt-5 text-sm text-fg-2">
            Предизвикателството изтече и вече не може да се играе. Влез в играта — дуелите и въпросите на деня те чакат.
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
    <div className="min-w-0 rounded-2xl border border-line bg-sunk/20 p-3.5">
      <dt className="text-xs font-semibold tracking-wide text-fg-3 uppercase">{label}</dt>
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
