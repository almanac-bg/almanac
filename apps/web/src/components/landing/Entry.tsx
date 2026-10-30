import { fmt } from '@quiz/client';
import { type ChallengePreview, type DailyPreview, MODES, ROOM_CODE_DIGITS } from '@quiz/shared';
import { ArrowRight, CalendarDays, DoorOpen, LogIn, RotateCcw, Swords, TriangleAlert, Zap } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { LoadFailure } from '../../lib/load';
import { Avatar } from '../Avatar';
import { Emoji } from '../Emoji';
import { accentText } from '../game/answers';
import { MINORS_NOTICE } from '../LegalLinks';
import { Button, Spinner } from '../ui';

/** Playing as a guest also accepts the terms, so the line (and the age note) sits under every way in. */
export function Consent() {
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

export function Or({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs font-semibold tracking-wide text-fg-3 uppercase">
      <span aria-hidden className="h-px flex-1 bg-line" />
      {children}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

export function GuestPlay({
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
export function NewcomerStart({
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
  const [roomCode, setRoomCode] = useState(false);
  return (
    <div>
      <p className="flex items-center gap-1.5 t-eyebrow" style={{ color: accentText(mode.accent[0]) }}>
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
      <p className="mt-2.5 text-center text-sm text-fg-3">Дуели, Роял, Соло — прогресът се пази и без регистрация.</p>
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
        <button
          type="button"
          onClick={() => setRoomCode(true)}
          aria-expanded={roomCode}
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-semibold text-violet-300 hover:text-violet-200"
        >
          <DoorOpen aria-hidden className="size-4" /> Имам код за стая
        </button>
      </div>
      {roomCode && <RoomCode />}
      <Consent />
    </div>
  );
}

/**
 * „almanac.bg, код 123456“, as a teacher puts it on the board: the room's invite page from here, where a pupil comes in
 * as a guest kept only for the room.
 */
function RoomCode() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === ROOM_CODE_DIGITS) navigate(`/join/${code}`);
      }}
      className="mt-2 flex gap-2"
    >
      <input
        ref={field}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, ROOM_CODE_DIGITS))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="Код на стая"
        aria-label="Код на стая"
        className="field h-11 min-w-0 flex-1 rounded-2xl px-4 font-mono text-lg tracking-[0.3em] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal"
      />
      <Button type="submit" variant="secondary" disabled={code.length !== ROOM_CODE_DIGITS}>
        Влез<span className="sr-only"> в стаята</span>
      </Button>
    </form>
  );
}

/** The day's questions opened signed out (/daily), or someone's link to them: their result to beat, and one tap. */
export function DailyLanding({
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
      <p className="flex items-center gap-1.5 t-eyebrow" style={{ color: accentText(mode.accent[0]) }}>
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
            {players > 0 ? ` · днес вече ${players === 1 ? 'игра 1 човек' : `играха ${fmt(players)} души`}` : ''}.
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
export function ChallengeLanding({
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
      <p className="flex items-center gap-1.5 t-eyebrow" style={{ color: accentText(mode.accent[0]) }}>
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

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-sunk/20 p-3.5">
      <dt className="text-xs font-semibold tracking-wide text-fg-3 uppercase">{label}</dt>
      <dd className="mt-1 font-display text-xl font-bold whitespace-nowrap tabular-nums sm:text-2xl">{value}</dd>
    </div>
  );
}
