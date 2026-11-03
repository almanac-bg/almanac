import { fmt } from '@almanac/client';
import { type ChallengePreview, type DailyPreview, MODES } from '@almanac/shared';
import { ArrowRight, CalendarDays, LogIn, Play, RotateCcw, Swords, TriangleAlert } from 'lucide-react';
import type { LoadFailure } from '../../lib/load';
import { Avatar } from '../Avatar';
import { Emoji } from '../Emoji';
import { accentText } from '../game/answers';
import { Button, Spinner } from '../ui';
import { Consent } from './Entry';

// Someone's link, opened signed out: the day's questions they played, or their challenge. A file of its own, with the
// avatar and the cosmetics behind it: the plain landing never shows a player (pages/lazy.ts → InvitationLanding).

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
              {/* A long name wraps rather than losing "те кани" to an ellipsis. A name in the text face (D2): the
                  display face's Cyrillic reads as Latin. */}
              <h2 className="text-2xl font-extrabold tracking-tight text-balance [overflow-wrap:anywhere]">
                {sharer.user.username} те кани
              </h2>
              <p className="text-sm text-fg-2 tabular-nums">
                {sharer.correct}/{mode.questions} · {fmt(sharer.score)} т. — можеш ли повече?
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-fg-3">Същите {mode.questions} въпроса, един опит. Без регистрация.</p>
        </>
      ) : (
        <>
          <h2 className="mt-2 t-section">10 въпроса, едни и същи за цяла България</h2>
          <p className="mt-1.5 text-sm text-fg-3">
            Около три минути, един опит до полунощ. Без регистрация
            {players > 0 ? ` · днес вече ${players === 1 ? 'игра 1 човек' : `играха ${fmt(players)} души`}` : ''}.
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
          <Play aria-hidden className="size-5" /> Играй като гост
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
          <h2 className="text-[1.375rem] leading-tight font-extrabold [overflow-wrap:anywhere] sm:text-2xl">
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
            <Play aria-hidden className="size-5" /> Играй като гост
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
      {/* Values come with units („250 т.“, „3 дни“): in the text face, whose „т“ doesn't read as Latin „m“ (D2). */}
      <dd className="mt-1 text-xl font-extrabold whitespace-nowrap tabular-nums sm:text-2xl">{value}</dd>
    </div>
  );
}
