import { MINORS_NOTICE, MODES, ROOM_CODE_DIGITS } from '@almanac/shared';
import { ArrowRight, CalendarDays, DoorOpen, LogIn, Play } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { accentText } from '../game/answers';
import { Button } from '../ui';

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
        <Play aria-hidden className="size-5" /> {label}
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
      <h2 className="mt-2 t-section">10 въпроса, едни и същи за цяла България</h2>
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
        <Play aria-hidden className="size-5" /> Играй като гост
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
