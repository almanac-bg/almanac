import { actions, api, fmt, plural, seconds, timeAgo, toast, useNow, useStore } from '@quiz/client';
import { BRAND, type ChallengeEntry, type ChallengeInfo, MODES, ordinal, titleName } from '@quiz/shared';
import clsx from 'clsx';
import { Clock, Gamepad2, Plus, RotateCcw, Save, Share2, Swords } from 'lucide-react';
import { m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Avatar, LevelBadge } from '../components/Avatar';
import { ClaimAccountModal } from '../components/ClaimAccount';
import { DuelCard } from '../components/duels';
import { Emoji } from '../components/Emoji';
import { LoadError } from '../components/LoadError';
import { Button, Card, EmptyState, Pill, SectionTitle, Spinner } from '../components/ui';
import { useLoad } from '../lib/load';
import { shareText } from '../lib/share';
import { usePageTitle } from '../lib/title';

const MODE = MODES.challenge;
const [ACCENT_FROM, ACCENT_TO] = MODE.accent;
const MEDALS = ['🥇', '🥈', '🥉'];
/** A link can go round a whole school: past this many rows the board shows the top and your own place. */
const BOARD_ROWS = 50;

/** Opened from the guest landing with "Приеми" already pressed: the run starts as soon as the connection is up. */
interface AcceptState {
  accept?: boolean;
}

// ─── /c/:id ──────────────────────────────────────────────────────────────────

export function ChallengePage() {
  usePageTitle('Предизвикателство');
  const { id = '' } = useParams();
  const { data, error, retry } = useLoad(() => api.challenge(id), id);

  if (!data && error) {
    return error.status === 404 ? (
      <Missing />
    ) : (
      <LoadError title="Предизвикателството не се зареди" error={error} onRetry={retry} />
    );
  }
  if (!data) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }
  return <Challenge info={data} />;
}

function Challenge({ info }: { info: ChallengeInfo }) {
  const me = useStore((s) => s.me)!;
  const connected = useStore((s) => s.connected);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  const location = useLocation();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const [starting, setStarting] = useState(false);

  // The server says whether it's expired as of loading; the clock keeps it honest while the page stays open.
  const expired = info.expired || now >= info.expiresAt;
  const mine = info.entries.find((e) => e.you) ?? null;
  const leader = info.entries[0] ?? null;
  const own = !!info.creator && info.creator.id === me.id;

  async function accept() {
    setStarting(true);
    const res = await actions.startChallenge(info.id);
    // On success the match starts and the app moves to /game by itself; the spinner stays until then.
    if (!res.ok) {
      toast({ kind: 'error', title: res.error });
      setStarting(false);
    }
  }

  // From the guest landing: "Приеми" was pressed there, so don't ask twice. Once only — Back or a reload won't restart it.
  const autoAccept = (location.state as AcceptState | null)?.accept === true;
  const autoStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on connect; the values it reads mustn't re-trigger it
  useEffect(() => {
    if (!autoAccept || autoStarted.current || !connected) return;
    autoStarted.current = true;
    navigate(location.pathname, { replace: true, state: null });
    if (!info.attempted && !expired) void accept();
  }, [autoAccept, connected]);

  function share() {
    const score = mine?.score ?? leader?.score ?? null;
    const lead =
      mine !== null
        ? `Предизвиквам те в ${BRAND.name}: ${MODE.questions} въпроса. Можеш ли да биеш ${plural(mine.score, 'точка', 'точки')}?`
        : score !== null
          ? `Предизвикателство в ${BRAND.name}: ${MODE.questions} въпроса. Можеш ли да биеш ${plural(score, 'точка', 'точки')}?`
          : `Предизвикателство в ${BRAND.name}: ${MODE.questions} въпроса, един опит. Колко ще събереш?`;
    void shareText(`${lead}\n${window.location.origin}/c/${info.id}`, 'Линкът е копиран');
  }

  // A friend duel: head to head, for its two; nobody else plays it.
  if (info.duelOnly) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <div className="text-center">
          <p className="t-eyebrow text-fg-3">Дуел с приятел</p>
          <h1 className="mt-2 t-page">{info.duel ? `Ти срещу ${info.duel.friend.username}` : 'Дуел между приятели'}</h1>
        </div>
        {info.duel ? (
          <DuelCard
            standing={info.duel}
            me={me}
            canPlay={!info.attempted && !expired}
            onPlay={accept}
            playing={starting || inGame}
          />
        ) : (
          <EmptyState
            icon="🤝"
            title="Този дуел е между двама приятели"
            body="Само двамата могат да го изиграят. Предизвикай свой приятел от страницата с приятели."
          />
        )}
      </div>
    );
  }

  // Short words only: the display font is wide, and "предизвикателство" alone overflows a phone.
  const title = own
    ? 'Ти предизвикваш'
    : info.creator
      ? `${info.creator.username} те предизвиква`
      : 'Покажи какво знаеш';

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <m.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="relative overflow-hidden p-5 sm:p-8">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-1"
            style={{ background: `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})` }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-28 -right-20 size-72 rounded-full opacity-15 glow"
            style={{ color: ACCENT_TO }}
          />

          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="flex items-center gap-1.5 t-eyebrow" style={{ color: ACCENT_FROM }}>
              <Swords aria-hidden className="size-3.5" /> Предизвикателство
            </p>
            <Pill className={clsx('ml-auto', expired && 'text-fg-3')}>
              <Clock aria-hidden className="size-3.5" />
              <span title={new Date(info.expiresAt).toLocaleString('bg-BG')}>
                {/* Phones: the clock says "expires", which keeps the pill on the same row. */}
                <span className={clsx(!expired && 'max-sm:sr-only')}>{expired ? 'Изтече' : 'Изтича'} </span>
                {expired || info.expiresAt - now >= 60_000 ? timeAgo(info.expiresAt) : 'след минута'}
              </span>
            </Pill>
          </div>

          {/* Your own avatar would only repeat the header; on the narrowest phones the title goes under the avatar. */}
          <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            {info.creator && !own && <Avatar avatar={info.creator.avatar} frame={info.creator.frame} size={64} />}
            <div className="min-w-0 flex-1 basis-48">
              <h1 className="font-display text-[1.375rem] leading-tight font-bold [overflow-wrap:anywhere] sm:text-3xl">
                {title}
              </h1>
              <p className="mt-1 text-sm text-fg-3">
                {MODE.questions} въпроса · {MODE.timeMs / 1000} секунди за всеки · един опит · без козове
              </p>
            </div>
          </div>

          <div className="relative mt-6">
            {mine ? (
              <YourResult entry={mine} total={info.total} expired={expired} />
            ) : expired ? (
              <p className="rounded-2xl border border-line bg-sunk/20 p-4 text-sm text-fg-2">
                {info.attempted
                  ? 'Предизвикателството изтече, а опитът ти не завърши.'
                  : 'Предизвикателството изтече, преди да го изиграеш. Ето как завърши.'}
              </p>
            ) : info.attempted ? (
              <Interrupted inGame={inGame} busy={starting} onRetry={accept} />
            ) : (
              <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="t-eyebrow text-fg-3">Резултат за биене</p>
                  {leader ? (
                    <>
                      <p className="mt-1 font-display text-3xl font-bold tabular-nums">{fmt(leader.score)} т.</p>
                      <p className="mt-0.5 truncate text-sm text-fg-3">
                        {leader.user?.username ?? 'Изтрит играч'} · {leader.correct}/{MODE.questions} верни
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-fg-2">Още никой не го е изиграл — постави първия резултат.</p>
                  )}
                </div>
                <Button
                  size="lg"
                  className="h-auto min-h-14 w-full py-2 text-balance sm:w-auto"
                  loading={starting}
                  disabled={inGame}
                  title={inGame ? 'Довърши мача, в който си' : undefined}
                  onClick={accept}
                >
                  <Swords aria-hidden className="size-5 max-sm:hidden" /> Приеми предизвикателството
                </Button>
              </div>
            )}
          </div>

          {!expired && (
            <div className="relative mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5">
              <p className="min-w-0 flex-1 basis-56 text-sm text-fg-3">
                Прати линка: всеки, който го отвори, играе същите въпроси веднъж — дори без профил.
              </p>
              <Button variant={own || mine ? 'primary' : 'secondary'} onClick={share} className="max-sm:w-full">
                <Share2 aria-hidden className="size-4" /> Сподели линка
              </Button>
            </div>
          )}
        </Card>
      </m.div>

      <Board info={info} />

      <CreateOwn />
    </div>
  );
}

function YourResult({ entry, total, expired }: { entry: ChallengeEntry; total: number; expired: boolean }) {
  const first = entry.rank === 1;
  const note = first
    ? total === 1
      ? 'Първият резултат е твой. Прати линка и виж кой ще го бие.'
      : expired
        ? `Най-добрият резултат от ${total} играчи.`
        : `Водиш пред още ${plural(total - 1, 'играч', 'играчи')}.`
    : `${ordinal(entry.rank)} място от ${total}.`;
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-sunk/20 p-4">
      <span aria-hidden className="text-4xl">
        <Emoji e={MEDALS[entry.rank - 1] ?? '🎯'} />
      </span>
      <div className="min-w-0">
        <p className="t-eyebrow text-fg-3">{expired ? 'Краен резултат' : 'Твоят резултат'}</p>
        <p className="mt-0.5 font-display text-3xl font-bold tabular-nums">{fmt(entry.score)} т.</p>
        <p className="mt-1 text-sm text-fg-2">
          <span className="font-semibold text-fg tabular-nums">
            {entry.correct}/{MODE.questions} верни
          </span>{' '}
          · {note}
        </p>
      </div>
    </div>
  );
}

/** Started but no result: either it's being played right now, or a server restart cut it short (that one can be replayed). */
function Interrupted({ inGame, busy, onRetry }: { inGame: boolean; busy: boolean; onRetry: () => void }) {
  if (inGame) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-sunk/20 p-4">
        <p className="min-w-0 flex-1 basis-48 text-sm text-fg-2">Играеш го в момента — резултатът ще се появи тук.</p>
        <Link
          to="/game"
          className="glass focus-ring inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-[15px] font-semibold hover:bg-tint/10"
        >
          <Gamepad2 aria-hidden className="size-4" /> Към играта
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4">
      <p className="min-w-0 flex-1 basis-48 text-sm text-amber-100">
        Опитът ти не завърши. Ако играта прекъсна по наша вина, можеш да го изиграеш отново.
      </p>
      <Button variant="secondary" loading={busy} onClick={onRetry}>
        <RotateCcw aria-hidden className="size-4" /> Опитай пак
      </Button>
    </div>
  );
}

function Board({ info }: { info: ChallengeInfo }) {
  const { entries } = info;
  const shown = entries.slice(0, BOARD_ROWS);
  const mine = entries.find((e) => e.you);
  const mineHidden = !!mine && mine.rank > BOARD_ROWS;

  return (
    <section aria-labelledby="challenge-board">
      <SectionTitle
        aside={info.total > 0 && <span className="text-sm text-fg-3">{plural(info.total, 'играч', 'играчи')}</span>}
      >
        <span id="challenge-board">Класиране</span>
      </SectionTitle>
      {entries.length === 0 ? (
        <Card>
          <EmptyState
            icon="🏁"
            title="Още няма резултати"
            body={
              info.expired
                ? 'Никой не го изигра навреме.'
                : 'Първият резултат оглавява класирането — и всеки следващ трябва да го бие.'
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {shown.map((e) => (
            <EntryRow key={e.rank} entry={e} creatorId={info.creator?.id ?? null} />
          ))}
          {mineHidden && (
            <>
              <div aria-hidden className="px-5 py-1 text-center text-xs text-fg-3">
                ⋯
              </div>
              <EntryRow entry={mine} creatorId={info.creator?.id ?? null} />
            </>
          )}
        </Card>
      )}
    </section>
  );
}

function EntryRow({ entry, creatorId }: { entry: ChallengeEntry; creatorId: number | null }) {
  const { user } = entry;
  const author = !!user && user.id === creatorId;
  const body = (
    <>
      <span aria-hidden className="w-6 shrink-0 text-center font-bold text-fg-3 tabular-nums">
        {MEDALS[entry.rank - 1] ? <Emoji e={MEDALS[entry.rank - 1]} /> : entry.rank}
      </span>
      <span className="sr-only">{ordinal(entry.rank)} място:</span>
      {user ? (
        <Avatar avatar={user.avatar} frame={user.frame} size={40} />
      ) : (
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-tint/5 text-lg text-fg-3">
          ?
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{user?.username ?? 'Изтрит играч'}</span>
          {user && <LevelBadge level={user.level} />}
        </div>
        <div className="truncate text-xs text-fg-3">
          {entry.you && <span className="font-semibold text-violet-300">Ти · </span>}
          {author ? 'Автор' : user ? titleName(user.title) : ''}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="font-semibold tabular-nums">{fmt(entry.score)} т.</span>
        <span className="text-xs text-fg-3 tabular-nums" title="Верни отговори · общо време за отговорите">
          {entry.correct}/{MODE.questions}
          {/* The tie-breaker; phones keep the room for the name. */}
          <span className="max-sm:hidden"> · {seconds(entry.timeMs)}</span>
        </span>
      </div>
    </>
  );
  const row = clsx('flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5', entry.you && 'bg-violet-500/10');
  return user ? (
    <Link
      to={`/profile/${encodeURIComponent(user.username)}`}
      className={clsx(row, 'focus-ring transition-colors hover:bg-tint/[0.04]')}
    >
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}

/** Making one of your own: ten fresh questions, played first by you, then the link goes to whoever you like. */
function CreateOwn() {
  const guest = useStore((s) => !!s.me?.isGuest);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);

  async function create() {
    setBusy(true);
    const res = await actions.startChallenge();
    // On success the match starts and the app moves to /game by itself.
    if (!res.ok) {
      toast({ kind: 'error', title: res.error });
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-4 p-5 sm:p-6">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="t-card">Предизвикай и ти</h2>
        <p className="mt-1 text-sm text-fg-3">
          {guest
            ? 'Свои предизвикателства правят играчи с профил. Запази прогреса си — отнема 10 секунди.'
            : `${MODE.questions} нови въпроса: изиграй ги първо ти, после прати линка на когото искаш.`}
        </p>
      </div>
      {guest ? (
        <Button variant="secondary" onClick={() => setClaiming(true)} className="max-sm:w-full">
          <Save aria-hidden className="size-4" /> Запази прогреса
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={create}
          loading={busy}
          disabled={inGame}
          className="h-auto min-h-11 py-2 text-balance max-sm:w-full"
        >
          <Plus aria-hidden className="size-4 max-sm:hidden" /> Създай предизвикателство
        </Button>
      )}
      {guest && (
        <ClaimAccountModal
          open={claiming}
          onClose={() => setClaiming(false)}
          reason="За да правиш свои предизвикателства, избери име и парола. Нивото, серията и всичко изиграно досега остават твои."
        />
      )}
    </Card>
  );
}

function Missing() {
  return (
    <div className="mx-auto max-w-xl space-y-8">
      <Card className="grid place-items-center gap-2 px-6 py-12 text-center">
        <span aria-hidden className="text-5xl">
          <Emoji e="🔗" />
        </span>
        <h1 className="t-section">Линкът не работи</h1>
        <p className="max-w-sm text-sm text-fg-3">
          Няма такова предизвикателство — линкът може да е непълен или вече изтрит.
        </p>
        <Link
          to="/"
          className="glass focus-ring mt-4 inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-[15px] font-semibold hover:bg-tint/10"
        >
          <Gamepad2 aria-hidden className="size-4" /> Към играта
        </Link>
      </Card>
      <CreateOwn />
    </div>
  );
}
