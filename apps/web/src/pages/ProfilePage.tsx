import {
  api,
  errorMessage,
  fmt,
  longDate,
  ordinal,
  pct,
  plural,
  seconds,
  timeAgo,
  toast,
  useStore,
} from '@quiz/client';
import {
  achievementById,
  CATEGORIES,
  isQueueMode,
  levelProgress,
  MASTERY_TIERS,
  MODES,
  type ModeId,
  type ProfileStats,
  RANK_TIERS,
  RARITIES,
  REPORT_REASONS,
  type ReportReason,
  seasonTitle,
  titleName,
} from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, Ban, Check, Flag, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar, LevelBadge, RankBadge } from '../components/Avatar';
import { DuelButton, recordLine } from '../components/duels';
import { Emoji } from '../components/Emoji';
import { FitName } from '../components/FitName';
import { accentText } from '../components/game/answers';
import { availableAchievements, useOpenQueues } from '../components/home/openQueues';
import { LoadError } from '../components/LoadError';
import { Button, buttonClass, Card, EmptyState, Modal, PageSpinner, ProgressBar, SectionTitle } from '../components/ui';
import { useLoad } from '../lib/load';
import { useMediaQuery } from '../lib/media';
import { usePageTitle } from '../lib/title';

const MODE_ORDER: ModeId[] = ['solo', 'daily', 'duel', 'teams', 'trio', 'squad', 'royale', 'evening', 'custom'];

/** The header's buttons: a row of their own under the level bar; from lg a column on the right. */
const HEADER_ACTIONS = 'col-span-2 sm:col-span-1 sm:col-start-2 lg:col-start-3 lg:row-span-2 lg:row-start-1';

export function ProfilePage() {
  const me = useStore((s) => s.me)!;
  const { username = me.username } = useParams();
  usePageTitle(username === me.username ? 'Профил' : username);
  const roomy = useMediaQuery('(min-width: 640px)');
  const friendsVersion = useStore((s) => s.friendsVersion);
  const openQueues = useOpenQueues();
  // A new name loads afresh; new XP or a friendship change refreshes the one on screen.
  const { data, error, retry, setData } = useLoad(() => api.profile(username), username, `${me.xp}:${friendsVersion}`);

  if (!data && error?.status === 404) return <EmptyState page icon="🕵️" title={error.message} />;
  if (!data && error) return <LoadError title="Профилът не се зареди" error={error} onRetry={retry} />;
  if (!data) {
    return <PageSpinner />;
  }

  const { user, overview: o } = data;
  const progress = levelProgress(user.xp);
  const isMe = user.id === me.id;
  const played = MODE_ORDER.filter((id) => data.modes.some((m) => m.mode === id));
  // Only what can be played today: a ranked queue that hasn't opened yet would read as a to-do nobody can do.
  // Трио is history (it joined Арена): listed only for those who played it.
  const unplayed = MODE_ORDER.filter(
    (id) => !played.includes(id) && id !== 'trio' && (!isQueueMode(id) || openQueues.includes(id)),
  );

  return (
    <div className="space-y-8">
      <Card className="relative overflow-hidden p-5 sm:p-8">
        <div className="absolute -top-24 -right-24 size-80 rounded-full glow text-fuchsia-600/20" />
        {/* Phones: a smaller avatar beside the name, the level bar and the buttons full width under them. Wider: the
            avatar spans the name and the bar; from lg the buttons go to the right. */}
        <div className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 sm:gap-x-6 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Avatar avatar={user.avatar} frame={user.frame} size={roomy ? 112 : 72} className="sm:row-span-2" />
          <div className="min-w-0 sm:self-end">
            <p className="text-sm font-semibold text-violet-300">{titleName(user.title)}</p>
            <FitName name={user.username} className="font-display text-2xl leading-tight font-bold sm:text-4xl" />
            <p className="mt-1 text-sm text-fg-3">
              Играе от {longDate(user.createdAt)} · {data.achievements.length}/
              {availableAchievements(openQueues, (id) => data.achievements.some((a) => a.id === id)).length} постижения
            </p>
          </div>
          <div className="col-span-2 max-w-md sm:col-span-1 sm:col-start-2 sm:self-start">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 text-sm">
              <span className="flex items-center gap-2 font-semibold">
                <LevelBadge level={progress.level} /> Ниво {progress.level}
              </span>
              <span className="text-fg-3 tabular-nums">{fmt(user.xp)} XP общо</span>
            </div>
            <ProgressBar value={progress.pct} />
          </div>
          {isMe ? (
            <div className={clsx('flex flex-wrap gap-2', HEADER_ACTIONS)}>
              <Link
                to="/locker"
                className="glass focus-ring inline-flex min-h-11 items-center rounded-2xl px-4 text-sm font-semibold hover:bg-tint/10"
              >
                Промени визията
              </Link>
              <Link
                to="/settings"
                className="glass focus-ring inline-flex min-h-11 items-center rounded-2xl px-4 text-sm font-semibold hover:bg-tint/10"
              >
                Настройки
              </Link>
            </div>
          ) : (
            // Friends and reports need a saved account; a guest gets nothing here that would only be refused.
            !me.isGuest && (
              <div className={clsx('flex flex-wrap items-center gap-2', HEADER_ACTIONS)}>
                <FriendActions profile={data} onChange={setData} />
                <ReportButton username={user.username} />
                <BlockButton profile={data} onChange={setData} />
              </div>
            )
          )}
        </div>
      </Card>

      <section>
        <SectionTitle>Статистика</SectionTitle>
        {/* Ten tiles: two columns of five on phones, one row of five per line from tablets up (no orphan row). */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Изиграни мачове" value={fmt(o.gamesPlayed)} />
          <Stat
            label="Победи"
            value={fmt(o.wins)}
            hint={
              o.multiplayerGames
                ? `${pct(o.wins, o.multiplayerGames)}% от ${plural(o.multiplayerGames, 'мач срещу съперници', 'мача срещу съперници')}`
                : undefined
            }
          />
          <Stat
            label="Точност"
            value={o.questionsAnswered ? `${pct(o.correctAnswers, o.questionsAnswered)}%` : '—'}
            hint={o.questionsAnswered ? `${fmt(o.correctAnswers)} от ${fmt(o.questionsAnswered)} верни` : undefined}
          />
          <Stat label="Най-дълга серия" value={`🔥 ${o.bestStreak}`} />
          <Stat
            label="Най-бърз верен отговор"
            value={o.fastestCorrectMs !== null ? seconds(o.fastestCorrectMs) : '—'}
          />
          <Stat label="Средно време (верни)" value={o.avgCorrectMs !== null ? seconds(o.avgCorrectMs) : '—'} />
          <Stat label="Рекорд в „Соло“" value={fmt(o.bestSoloScore)} />
          <Stat
            label="Факти в алманаха"
            value={`📖 ${fmt(data.almanac.facts)}`}
            hint={`от ${fmt(data.almanac.total)}`}
            to={isMe ? '/almanac' : undefined}
          />
          <Stat label="Дневна серия" value={`🗓️ ${o.dailyStreak}`} hint={`Най-дълга: ${o.bestDailyStreak}`} />
          <Stat label="Одобрени въпроси" value={`✍️ ${o.questionsApproved}`} />
        </div>
      </section>

      {data.seasons.length > 0 && (
        <section>
          <SectionTitle>Сезони</SectionTitle>
          <div className="flex flex-wrap gap-2.5">
            {data.seasons.map(({ season, tier }) => {
              const t = tier ? RANK_TIERS.find((x) => x.id === tier)! : null;
              return (
                <div
                  key={season}
                  className="flex items-center gap-2.5 rounded-2xl border px-3.5 py-2"
                  style={t ? { borderColor: `${t.color}55`, background: `${t.color}12` } : undefined}
                >
                  {t ? <Emoji e="🏅" size="1.5rem" /> : <span className="text-xl">—</span>}
                  <span className="text-sm">
                    <span className="block font-semibold">{seasonTitle(season)}</span>
                    <span className="text-xs" style={{ color: t ? accentText(t.color) : undefined }}>
                      {t ? t.name : 'Без ранг'}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>Режими</SectionTitle>
          <Card className="divide-y divide-line">
            {played.map((id) => {
              const m = data.modes.find((x) => x.mode === id);
              const mode = MODES[id];
              // Played alone (the daily too): no wins to count.
              const multiplayer = id !== 'solo' && id !== 'daily';
              return (
                <div key={id} className="flex items-center gap-4 px-5 py-3.5">
                  <span
                    className="h-8 w-1 rounded-full"
                    style={{ background: `linear-gradient(${mode.accent[0]}, ${mode.accent[1]})` }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{mode.name}</div>
                    <div className="text-xs text-fg-3">
                      {m ? plural(m.games, 'мач', 'мача') : 'Още не е игран'}
                      {m && multiplayer && ` · ${pct(m.wins, m.games)}% победи`}
                      {m?.avgPlacement != null && ` · средно ${ordinal(Math.round(m.avgPlacement))} място`}
                    </div>
                  </div>
                  {m?.rating != null && <RankBadge rating={m.rating} />}
                </div>
              );
            })}
            {/* The modes not played yet, in one line rather than a row each saying "nothing yet". */}
            {unplayed.length > 0 && (
              <p className="px-5 py-3.5 text-sm text-fg-3">
                Още без мачове: {unplayed.map((id) => MODES[id].name).join(', ')}
              </p>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle>Точност по категории</SectionTitle>
          <Card className="p-5">
            <CategoryBars categories={data.categories} />
          </Card>
        </section>
      </div>

      <section>
        <SectionTitle
          aside={
            isMe && (
              <Link
                to="/achievements"
                className="text-sm font-semibold whitespace-nowrap text-violet-300 hover:text-violet-200"
              >
                Всички →
              </Link>
            )
          }
        >
          Последни постижения
        </SectionTitle>
        {data.achievements.length === 0 ? (
          <Card className="p-2">
            <EmptyState icon="🏆" title="Все още няма постижения" body="Изиграй първия си мач и започни колекцията." />
          </Card>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {data.achievements.slice(0, 12).map(({ id, unlockedAt }) => {
              const a = achievementById(id);
              if (!a) return null;
              const color = RARITIES[a.rarity].color;
              return (
                <div
                  key={id}
                  title={`${a.description} · ${longDate(unlockedAt)}`}
                  className="flex items-center gap-2.5 rounded-2xl border px-3 py-2"
                  style={{ borderColor: `${color}44`, background: `${color}10` }}
                >
                  <Emoji e={a.icon} size="1.5rem" />
                  <span className="text-sm font-semibold">{a.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Последни мачове</SectionTitle>
        <Card className="overflow-x-auto">
          {data.recent.length === 0 ? (
            <EmptyState
              icon="🎮"
              title="Няма изиграни мачове"
              body={isMe ? 'Първият мач пълни тази страница: точност, серии, рекорди.' : undefined}
            >
              {isMe && (
                <Link to="/" className={buttonClass({ size: 'sm' })}>
                  Към игрите <ArrowRight aria-hidden className="size-4" />
                </Link>
              )}
            </EmptyState>
          ) : (
            <>
              {/* Phones: one match per row, the numbers under it, instead of a table to scroll sideways. */}
              <ul className="divide-y divide-line sm:hidden">
                {data.recent.map((r) => (
                  <li key={r.matchId} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">{MODES[r.mode].name}</span>
                      <span className="shrink-0 text-xs text-fg-3">{timeAgo(r.endedAt)}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-fg-2 tabular-nums">
                      {r.players > 1 && <Placement match={r} />}
                      <span>{fmt(r.score)} т.</span>
                      <span>
                        {r.correct}/{r.questions} верни
                      </span>
                      <span className="text-violet-300">+{fmt(r.xp)} XP</span>
                      {r.ratingDelta !== null && (
                        <span className={ratingClass(r.ratingDelta)}>{signed(r.ratingDelta)} рейтинг</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
              <table className="hidden w-full min-w-[560px] text-sm sm:table">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-fg-3 uppercase">
                    <th className="px-5 py-3 font-semibold">Режим</th>
                    <th className="px-3 py-3 font-semibold">Място</th>
                    <th className="px-3 py-3 text-right font-semibold">Точки</th>
                    <th className="px-3 py-3 text-right font-semibold">Верни</th>
                    <th className="px-3 py-3 text-right font-semibold">XP</th>
                    <th className="px-3 py-3 text-right font-semibold">Рейтинг</th>
                    <th className="px-5 py-3 text-right font-semibold">Кога</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.recent.map((r) => (
                    <tr key={r.matchId} className="hover:bg-tint/[0.03]">
                      <td className="px-5 py-3 font-semibold">{MODES[r.mode].name}</td>
                      <td className="px-3 py-3">
                        {r.players === 1 ? <span className="text-fg-3">—</span> : <Placement match={r} />}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmt(r.score)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {r.correct}/{r.questions}
                      </td>
                      <td className="px-3 py-3 text-right text-violet-300 tabular-nums">+{fmt(r.xp)}</td>
                      <td className={clsx('px-3 py-3 text-right tabular-nums', ratingClass(r.ratingDelta))}>
                        {r.ratingDelta === null ? '—' : signed(r.ratingDelta)}
                      </td>
                      <td className="px-5 py-3 text-right text-fg-3">{timeAgo(r.endedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </section>
    </div>
  );
}

/** „2-ро от 5“; alone (Соло, a link, the daily) a place says nothing. */
function Placement({ match }: { match: ProfileStats['recent'][number] }) {
  if (match.players <= 1) return <span className="text-fg-3">—</span>;
  const won = match.placement === 1;
  return (
    <span className={clsx('whitespace-nowrap', won && 'font-bold text-amber-300')}>
      {won && <Emoji e="🏆" className="mr-1" />}
      {ordinal(match.placement)} <span className="sr-only">място </span>от {match.players}
    </span>
  );
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
const ratingClass = (delta: number | null) =>
  delta === null ? 'text-fg-3' : delta >= 0 ? 'text-emerald-300' : 'text-rose-300';

/** Add / accept / challenge, depending on how the viewer relates to this player. */
function FriendActions({ profile, onChange }: { profile: ProfileStats; onChange: (p: ProfileStats) => void }) {
  const [busy, setBusy] = useState(false);
  const { user, friendship } = profile;

  async function run(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await fn();
      if (success) toast({ kind: 'success', title: success });
      onChange(await api.profile(user.username));
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (friendship === 'friends') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-sm font-semibold text-emerald-300">
          <Check className="size-4" /> Приятели
        </span>
        <DuelButton friend={user} />
        {profile.duels && (
          <span className="text-sm text-fg-2">
            Дуели: <b className="text-fg tabular-nums">{recordLine(profile.duels)}</b>
          </span>
        )}
      </div>
    );
  }
  if (friendship === 'outgoing') {
    return (
      <Button variant="secondary" disabled>
        Поканата е изпратена
      </Button>
    );
  }
  if (friendship === 'incoming') {
    return (
      <Button onClick={() => run(() => api.acceptFriend(user.id), 'Вече сте приятели!')} loading={busy}>
        <Check className="size-4" /> Приеми поканата
      </Button>
    );
  }
  return (
    <Button onClick={() => run(() => api.addFriend(user.username), 'Поканата е изпратена')} loading={busy}>
      <UserPlus className="size-4" /> Добави приятел
    </Button>
  );
}

/** Blocks or unblocks this player: a blocked one is no friend, and neither can ask the other again. */
function BlockButton({ profile, onChange }: { profile: ProfileStats; onChange: (p: ProfileStats) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { user, blocked } = profile;

  async function act() {
    setBusy(true);
    try {
      await (blocked ? api.unblock(user.id) : api.block(user.id));
      toast({ kind: 'info', title: blocked ? 'Профилът е отблокиран' : `${user.username} е блокиран профил` });
      setOpen(false);
      onChange(await api.profile(user.username));
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (blocked)
    return (
      <Button variant="ghost" onClick={act} loading={busy}>
        <Ban className="size-4" /> Отблокирай
      </Button>
    );
  return (
    <>
      <Button variant="ghost" className="text-fg-3" onClick={() => setOpen(true)}>
        <Ban className="size-4" /> Блокирай
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Да блокирам ли ${user.username}?`}>
        <p className="text-fg-2">
          Профилът изчезва от приятелите ти (ако е там) и никой от двама ви не може да праща покана на другия. Можеш да
          го отблокираш по всяко време от Настройки. Ако има нарушение, докладвай го — блокирането не стига до
          модераторите.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Отказ
          </Button>
          <Button variant="danger" onClick={act} loading={busy}>
            <Ban className="size-4" /> Блокирай
          </Button>
        </div>
      </Modal>
    </>
  );
}

function ReportButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason) return;
    setBusy(true);
    try {
      await api.report(username, reason, details);
      toast({ kind: 'success', title: 'Благодарим! Модераторите ще прегледат доклада.' });
      setOpen(false);
      setReason(null);
      setDetails('');
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Докладвай"
        aria-label="Докладвай играча"
        className="focus-ring grid size-11 place-items-center rounded-2xl text-fg-3 hover:bg-rose-500/10 hover:text-rose-300"
      >
        <Flag className="size-4.5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Докладвай ${username}`}>
        <div className="space-y-2">
          {REPORT_REASONS.map((r) => (
            <label
              key={r.id}
              className={clsx(
                'flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors',
                reason === r.id ? 'border-rose-400/50 bg-rose-500/10' : 'border-line hover:bg-tint/5',
              )}
            >
              <input
                type="radio"
                name="reason"
                checked={reason === r.id}
                onChange={() => setReason(r.id)}
                className="accent-rose-400"
              />
              {r.label}
            </label>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 500))}
          placeholder="Подробности (по желание)"
          rows={3}
          className="field mt-4 w-full rounded-2xl p-3 text-sm"
        />
        <p className="mt-2 text-xs text-fg-3">Докладите са анонимни за докладвания играч.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Отказ
          </Button>
          <Button variant="danger" onClick={submit} disabled={!reason} loading={busy}>
            Изпрати доклад
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** A number with what it is; `to`: where its details are (your own almanac). */
function Stat({ label, value, hint, to }: { label: string; value: string; hint?: string; to?: string }) {
  const body = (
    <>
      <div className="text-xs font-semibold text-fg-3">{label}</div>
      <div className="mt-1.5 text-2xl font-bold sm:text-[1.7rem]">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-fg-3">{hint}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="focus-ring glass block rounded-3xl p-4 transition-colors hover:bg-tint/[0.06] sm:p-5">
      {body}
    </Link>
  ) : (
    <Card className="p-4 sm:p-5">{body}</Card>
  );
}

/**
 * One series → one color. Value column doubles as the table view; hovering a row shows its counts, which screen
 * readers get in the value cell (ten rows as tab stops only to show a tooltip were ten extra stops on the way down).
 */
function CategoryBars({ categories }: { categories: ProfileStats['categories'] }) {
  const [active, setActive] = useState<string | null>(null);
  const rows = CATEGORIES.map((c) => {
    const s = categories.find((x) => x.category === c.id);
    return { ...c, answered: s?.answered ?? 0, correct: s?.correct ?? 0, tier: s?.tier ?? null };
  });
  const tiered = rows.some((r) => r.tier !== null);
  const BAR = '#a78bfa';

  // biome-ignore-start lint/a11y/useSemanticElements: CSS-grid rows; a <table> restyled so can lose its semantics
  return (
    <div role="table" aria-label="Точност по категории" className="space-y-1">
      {rows.map((r) => {
        const accuracy = r.answered ? r.correct / r.answered : 0;
        const isActive = active === r.id;
        return (
          // biome-ignore lint/a11y/useFocusableInteractive: a table row, not a widget (the hover adds nothing it says)
          <div
            key={r.id}
            role="row"
            onMouseEnter={() => setActive(r.id)}
            onMouseLeave={() => setActive(null)}
            className={clsx(
              'relative grid grid-cols-[minmax(0,11.5rem)_1fr_3.5rem] items-center gap-3 rounded-xl px-2 py-1.5',
              isActive && 'bg-tint/[0.04]',
            )}
          >
            <span role="cell" className="flex min-w-0 items-center gap-2 text-sm text-fg-2">
              <Emoji e={r.icon} />
              <span className="truncate">{r.name}</span>
              {r.tier !== null && (
                <span title={MASTERY_TIERS[r.tier].name} className="shrink-0">
                  <Emoji e={MASTERY_TIERS[r.tier].icon} />
                  <span className="sr-only"> ({MASTERY_TIERS[r.tier].name})</span>
                </span>
              )}
            </span>
            <span role="cell" className="relative h-2.5">
              {/* The baseline the bar grows from; with no answers it would stand alone, a tick that reads as a glitch. */}
              {r.answered > 0 && <span className="absolute inset-y-0 left-0 w-full border-l border-tint/15" />}
              {r.correct > 0 && (
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-700"
                  style={{ width: `${accuracy * 100}%`, background: BAR, opacity: active && !isActive ? 0.45 : 1 }}
                />
              )}
            </span>
            <span role="cell" className="text-right text-sm font-semibold tabular-nums">
              {r.answered ? (
                <>
                  {Math.round(accuracy * 100)}%
                  <span className="sr-only">
                    {' '}
                    ({fmt(r.correct)} от {fmt(r.answered)} верни)
                  </span>
                </>
              ) : (
                <span className="text-fg-3">
                  —<span className="sr-only"> (още няма отговори)</span>
                </span>
              )}
            </span>
            {isActive && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-full right-2 z-10 mt-1 rounded-xl border border-line bg-ink-2 px-3 py-2 text-xs whitespace-nowrap text-fg shadow-xl"
              >
                {r.answered ? (
                  <>
                    <b>{r.name}</b> · {fmt(r.correct)} от {fmt(r.answered)} верни
                  </>
                ) : (
                  'Още няма отговори в тази категория'
                )}
              </span>
            )}
          </div>
        );
      })}
      <p className="pt-2 text-xs text-fg-3">Дял верни отговори от всички зададени въпроси в категорията.</p>
      {tiered && (
        <p className="flex flex-wrap gap-x-2 text-xs text-fg-3">
          Майсторство:
          {MASTERY_TIERS.map((t) => (
            <span key={t.id} className="whitespace-nowrap">
              <Emoji e={t.icon} /> {t.name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
  // biome-ignore-end lint/a11y/useSemanticElements: end of the grid-laid table
}
