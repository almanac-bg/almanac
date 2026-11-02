import { actions, api, fmt, plural, toast, useNow, useStore } from '@quiz/client';
import { BRAND, type DailyInfo, type DailyPreview, dayKey, dayTheme, MODES, TIME_ZONE } from '@quiz/shared';
import { ArrowRight, CalendarDays, ChartColumn, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Avatar } from '../components/Avatar';
import { countdown } from '../components/home/time';
import { LoadError } from '../components/LoadError';
import { DayField } from '../components/results/DayField';
import { Button, Card, Spinner } from '../components/ui';
import { dailyLinkUrl, offBoardLine, placeShown } from '../lib/daily';
import { useLoad } from '../lib/load';
import { savedDailyShare, shareText } from '../lib/share';
import { usePageTitle } from '../lib/title';

const MODE = MODES.daily;
const [ACCENT_FROM, ACCENT_TO] = MODE.accent;

/** Opened from the landing page with "Играй" already pressed: the run starts as soon as the connection is up. */
interface PlayState {
  play?: boolean;
}

/** The day as a date ("28 октомври"). */
export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', timeZone: TIME_ZONE });

// ─── /daily, /daily/:code ────────────────────────────────────────────────────

/** Today's questions: from the lobby, the streak email, or a friend's link (whose result is there to beat). */
export function DailyPage() {
  usePageTitle(MODE.name);
  const { code } = useParams();
  const me = useStore((s) => s.me)!;
  const { data: info, error, retry } = useLoad(() => api.daily(), `${me.daily.day}:${me.daily.played}`);
  const { data: link } = useLoad<DailyPreview | null>(
    () => (code ? api.dailyPreview(code) : Promise.resolve(null)),
    code ?? '',
  );

  if (!info && error) return <LoadError title="Въпросите на деня не се заредиха" error={error} onRetry={retry} />;
  if (!info) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-amber-300" />
      </div>
    );
  }
  return <Daily info={info} link={link ?? null} code={code ?? null} />;
}

function Daily({ info, link, code }: { info: DailyInfo; link: DailyPreview | null; code: string | null }) {
  const me = useStore((s) => s.me)!;
  const connected = useStore((s) => s.connected);
  const location = useLocation();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [starting, setStarting] = useState(false);
  // Your own link opened: nothing to compare with yourself.
  const sharer = link?.sharer && link.sharer.user.username !== me.username ? link.sharer : null;
  const theme = dayTheme(info.day);

  async function play() {
    setStarting(true);
    // The code as it is: the server ignores one that isn't today's, or is your own (the preview may not be here yet).
    const res = await actions.startDaily(code ?? undefined);
    // On success the match starts and the app moves to /game by itself; the spinner stays until then.
    if (!res.ok) {
      toast({ kind: 'error', title: res.error });
      setStarting(false);
    }
  }

  // From the landing page: "Играй" was pressed there, so don't ask twice. Once only — Back or a reload won't restart it.
  const autoPlay = (location.state as PlayState | null)?.play === true;
  const autoStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on connect; the values it reads mustn't re-trigger it
  useEffect(() => {
    if (!autoPlay || autoStarted.current || !connected) return;
    autoStarted.current = true;
    navigate(location.pathname, { replace: true, state: null });
    if (!info.attempted) void play();
  }, [autoPlay, connected]);

  async function share() {
    const saved = savedDailyShare(info.day);
    if (saved) return shareText(saved, 'Линкът и резултатът са копирани');
    const url = await dailyLinkUrl();
    const played = info.played;
    shareText(
      played
        ? `${BRAND.mark} ${BRAND.name} №${info.number} · ${played.correct}/${MODE.questions}\n${fmt(played.score)} т.\n${url}`
        : url,
      'Линкът е копиран',
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div
          aria-hidden
          className="absolute inset-0 opacity-25"
          style={{
            background: `radial-gradient(100% 120% at 100% 0%, ${ACCENT_FROM}, transparent 55%), radial-gradient(80% 90% at 0% 100%, ${ACCENT_TO}55, transparent 70%)`,
          }}
        />
        <div className="relative">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold tracking-wider text-[#451a03] uppercase"
            style={{ background: `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})` }}
          >
            <CalendarDays className="size-3.5" /> №{info.number} · {dayLabel(info.day)}
          </span>
          <h1 className="mt-3 t-page">{MODE.name}</h1>
          <p className="mt-2 text-fg-2">{MODE.tagline}</p>
          {theme && (
            <p className="mt-1 font-semibold text-amber-300">
              Темата днес:{' '}
              <Link
                to={theme.page}
                className="underline decoration-amber-300/50 underline-offset-2 hover:decoration-amber-300"
              >
                {theme.name}
              </Link>
            </p>
          )}

          {sharer && (
            <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-sunk/25 p-3.5">
              <Avatar avatar={sharer.user.avatar} frame={sharer.user.frame} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{sharer.user.username} те кани</p>
                <p className="text-sm text-fg-2 tabular-nums">
                  {sharer.correct}/{MODE.questions} · {fmt(sharer.score)} т. — можеш ли повече?
                </p>
              </div>
            </div>
          )}

          <div className="mt-6">
            {info.played ? (
              <>
                <p className="text-xs text-fg-3">Твоят резултат днес</p>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {fmt(info.played.score)} т.{' '}
                  <span className="text-lg text-fg-2">
                    · {info.played.correct}/{MODE.questions}
                  </span>
                  {!info.offBoard && placeShown(info.total) && (
                    <span className="text-lg font-semibold text-amber-300">
                      {' '}
                      · #{info.played.rank} <span className="text-fg-3">от {info.total}</span>
                    </span>
                  )}
                </p>
                {info.offBoard && (
                  <p className="mt-1 text-sm text-fg-3">
                    {offBoardLine({
                      guest: me.isGuest,
                      madeToday: dayKey(me.createdAt) === info.day,
                      rank: info.played.rank,
                      total: info.total,
                    })}
                  </p>
                )}
                {info.played.field && (
                  <DayField field={info.played.field} correct={info.played.correct} className="mt-5 max-w-sm" />
                )}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button onClick={() => void share()}>
                    <Share2 className="size-4" /> Прати днешните въпроси
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/leaderboard?board=daily')}>
                    <ChartColumn className="size-4" /> Класиране
                  </Button>
                </div>
                <p className="mt-3 text-xs text-fg-3 tabular-nums">Нови въпроси след {countdown(info.endsAt - now)}</p>
              </>
            ) : info.attempted ? (
              <p className="text-fg-3">Днешният опит е използван. Нови въпроси след {countdown(info.endsAt - now)}.</p>
            ) : (
              <>
                <Button variant="gold" size="lg" onClick={() => void play()} loading={starting}>
                  Играй днешните <ArrowRight className="size-5" />
                </Button>
                <p className="mt-3 text-sm text-fg-3">
                  {MODE.questions} въпроса, около три минути, без козове. Един опит до полунощ
                  {info.total > 0
                    ? ` · днес вече ${info.total === 1 ? 'игра' : 'играха'} ${plural(info.total, 'човек', 'души')}`
                    : ''}
                  .
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      {info.fromMyLink.length > 0 && (
        <Card className="p-5 sm:p-6">
          <h2 className="t-card">По твоя линк днес</h2>
          <ol className="mt-4 space-y-2.5">
            {info.fromMyLink.map((p) => (
              <li key={p.user.id} className="flex items-center gap-3 text-sm">
                <Avatar avatar={p.user.avatar} frame={p.user.frame} size={32} />
                <span className="min-w-0 flex-1 truncate font-semibold">{p.user.username}</span>
                <span className="text-fg-2 tabular-nums">
                  {p.correct}/{MODE.questions} · {fmt(p.score)} т.
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
