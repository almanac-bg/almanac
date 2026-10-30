import { api, errorMessage, plural, setState, toast } from '@quiz/client';
import { BRAND, type ChallengePreview, type DailyPreview, type GroupPreview, PASSWORD_MIN_LENGTH } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, DoorOpen, UsersRound } from 'lucide-react';
import { m } from 'motion/react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Emoji } from '../components/Emoji';
import { LegalLinks } from '../components/LegalLinks';
import { AboutGame, ProofLine } from '../components/landing/About';
import { DESKTOP } from '../components/landing/device';
import { ChallengeLanding, Consent, DailyLanding, GuestPlay, NewcomerStart, Or } from '../components/landing/Entry';
import { ForgotPassword } from '../components/landing/ForgotPassword';
import { Logo } from '../components/NavBar';
import { PasswordField } from '../components/PasswordField';
import { Button, Card, Field, INPUT, Segmented } from '../components/ui';
import { type CredentialField, credentialsProblems } from '../lib/credentials';
import { embeddedChallenge } from '../lib/embedded';
import { useLoad } from '../lib/load';
import { isPainted, paintedReturning } from '../lib/painted';
import { isReturning, markReturning } from '../lib/returning';
import { usePageTitle } from '../lib/title';

// What works with nobody else online comes first: the day's questions (everyone's the same) and a link to a friend.
const FEATURES = [
  { icon: '🗓️', title: 'Въпросите на деня', body: 'Едни и същи 10 за цяла България, класиране до полунощ' },
  { icon: '🔗', title: 'Предизвикай приятел', body: 'Пращаш линк, играе същите въпроси, когато може' },
  { icon: '⚔️', title: 'Дуели и Роял', body: 'Битки в реално време, до 8 играчи' },
];

/** The modes the page below the first screen describes, in the order a newcomer meets them. */

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
    null,
    challengeId ? embeddedChallenge(challengeId) : null,
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
      const { user, emailNotSent } =
        mode === 'login'
          ? { ...(await api.login(username, password)), emailNotSent: undefined }
          : await api.register(username, password, email.trim() || undefined);
      markReturning();
      setState({ me: user });
      if (emailNotSent)
        toast({
          kind: 'info',
          title: 'Профилът е създаден, но писмото за потвърждение не тръгна',
          body: `${emailNotSent} Добави имейла отново от Настройки.`,
        });
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
      // From a room's link: a guest only for the room (a pupil in a class), erased within an hour of leaving.
      const { user } = await api.guest(!!roomCode);
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
        <m.header
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
        </m.header>

        <m.div
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
                        гост или с профила си, за да се присъединиш. Гостът е само за стаята: без имейл и парола, а до
                        час, след като излезеш, се изтрива с всичко изиграно.
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
                    <PasswordField
                      value={password}
                      onChange={setPassword}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      invalid={!!error && invalid.includes('password')}
                      describedBy={error && invalid.includes('password') ? `${id}-error` : undefined}
                      inputRef={passwordRef}
                      minLength={PASSWORD_MIN_LENGTH}
                      placeholder={mode === 'register' ? `поне ${PASSWORD_MIN_LENGTH} символа` : '••••••••'}
                    />
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
        </m.div>

        <ul className="relative grid gap-3 sm:grid-cols-3 md:col-start-1 md:row-start-2 md:grid-cols-1 md:self-start lg:max-w-xl lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <m.li
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
            </m.li>
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
