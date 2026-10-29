import { actions, api, plural, toast, useStore } from '@quiz/client';
import {
  BRAND,
  CATEGORIES,
  type CategoryChoice,
  ROOM_LIMITS,
  type RoomPlayer,
  type RoomSettingsPatch,
  type RoomState,
  TEAMS,
  type TeamId,
} from '@quiz/shared';
import clsx from 'clsx';
import {
  ArrowLeftRight,
  Bot,
  Check,
  Copy,
  Crown,
  Image as ImageIcon,
  LogOut,
  Minus,
  Play,
  Plus,
  Presentation,
  Send,
  Share2,
  Skull,
  Target,
  UserMinus,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Avatar, PlayerTag } from '../components/Avatar';
import { FreshPowerupNotes } from '../components/game/Powerups';
import { teamColor } from '../components/game/teams';
import { LoadError } from '../components/LoadError';
import { PRESENCE } from '../components/presence';
import { Button, Card, Modal, Segmented, Spinner, SwitchTrack } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';

export function RoomPage() {
  usePageTitle('Частна стая');
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [kicking, setKicking] = useState<string | null>(null);

  if (!room) return <Navigate to="/" replace />;

  const isHost = room.hostId === `u${me.id}`;
  const s = room.settings;
  const inviteUrl = `${window.location.origin}/join/${room.code}`;
  const hasBots = room.players.some((p) => p.isBot);
  const teamsReady = !s.teams || new Set(room.players.map((p) => p.team)).size === 2;
  // „Само водя“: the host runs it on a big screen, so the players are everyone else.
  const playing = s.hostPlays ? room.players : room.players.filter((p) => !p.isHost);
  const canStart = (s.hostPlays ? playing.length >= 2 : playing.some((p) => !p.isBot)) && teamsReady;
  const startHint =
    !s.hostPlays && !playing.some((p) => !p.isBot)
      ? 'Прати кода на играчите — играта започва, щом влезе поне един.'
      : s.hostPlays && playing.length < 2
        ? 'Покани приятел или добави бот, за да започнеш.'
        : !teamsReady
          ? 'И двата отбора трябва да имат поне по един играч.'
          : null;
  const crowded = room.players.length > ROOM_LIMITS.eliminationPlayers;
  // „Микс“, „Избира последният“ (rounds) or one category the host picks.
  const categoryMode = s.category !== 'mixed' ? 'one' : s.rounds ? 'rounds' : 'mixed';
  // Still in the room (they may have left while the dialog was open).
  const kickTarget = room.players.find((p) => p.id === kicking) ?? null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ kind: 'info', title: `Кодът е ${room!.code}` });
    }
  }

  /** Phones get the system share sheet (straight into a chat); elsewhere the link goes to the clipboard. */
  async function share() {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({
          title: BRAND.name,
          text: `Ела да играем в ${BRAND.name}! Стая ${room!.code}`,
          url: inviteUrl,
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // the sheet was closed
      }
    }
    await copy();
  }

  async function start() {
    setStarting(true);
    const res = await actions.startRoom();
    setStarting(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }

  // A bot comes back with one tap; a person can only return with a new invite, so ask first.
  function kick(p: RoomPlayer) {
    if (p.isBot) actions.roomKick(p.id);
    else setKicking(p.id);
  }

  const update = (patch: RoomSettingsPatch) => actions.roomSettings(patch);

  const startButton = (
    <Button size="lg" className="w-full" onClick={start} loading={starting} disabled={!canStart}>
      <Play className="size-5" /> Започни играта
    </Button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="t-eyebrow text-fuchsia-300">Частна стая</h1>
          <button
            type="button"
            onClick={copy}
            className="focus-ring group mt-1 flex min-h-11 items-center gap-3 rounded-xl"
            title="Копирай линк за покана"
          >
            <span className="font-mono text-4xl font-bold tracking-[0.25em] sm:text-5xl">{room.code}</span>
            <span className="grid size-9 place-items-center rounded-xl bg-tint/5 text-fg-2 group-hover:bg-tint/10">
              {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
            </span>
          </button>
          <p className="mt-1 text-sm text-fg-3" aria-live="polite">
            {copied ? 'Линкът е копиран — прати го на приятели!' : 'Натисни кода, за да копираш линк за покана.'}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={share}>
            {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />} Покани
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              actions.leaveRoom();
              navigate('/');
            }}
          >
            <LogOut className="size-4" /> Напусни стаята
          </Button>
        </div>
        {/* Wide screens start from up here, in view however long the settings run (narrower ones from the bar pinned
            to the bottom). */}
        <div className="hidden w-full justify-end lg:flex">
          {isHost ? (
            <div className="flex items-center gap-3">
              {startHint && <p className="max-w-xs text-right text-sm text-fg-3">{startHint}</p>}
              <div className="w-56">{startButton}</div>
            </div>
          ) : (
            <p className="rounded-2xl bg-tint/5 px-4 py-2.5 text-sm text-fg-2">Чакаме домакина да започне…</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card className="p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="t-card">
                Играчи{' '}
                <span className="text-fg-3">
                  {room.players.length}/{s.maxPlayers}
                </span>
              </h2>
              {isHost && (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => actions.roomBot('add')}
                    disabled={room.players.length >= s.maxPlayers}
                  >
                    <Bot className="size-4" /> Добави бот
                  </Button>
                  {hasBots && (
                    <Button
                      variant="ghost"
                      onClick={() => actions.roomBot('remove')}
                      aria-label="Махни бот"
                      title="Махни бот"
                    >
                      <Minus className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            {s.teams ? (
              <TeamColumns room={room} meId={me.id} isHost={isHost} onKick={kick} />
            ) : (
              <Seats room={room} meId={me.id} isHost={isHost} onKick={kick} />
            )}
          </Card>

          {/* Guests have no friends list (the room link above works for everyone). */}
          {!me.isGuest && <InviteFriends room={room} />}
        </div>

        <Card className="space-y-5 self-start p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="t-card">Настройки</h2>
            {!isHost && <span className="text-xs text-fg-3">Само домакинът ги променя</span>}
          </div>

          <MaxPlayers
            value={s.maxPlayers}
            min={Math.max(ROOM_LIMITS.maxPlayers[0], room.players.length)}
            max={s.elimination ? ROOM_LIMITS.eliminationPlayers : ROOM_LIMITS.maxPlayers[1]}
            disabled={!isHost}
            onChange={(maxPlayers) => update({ maxPlayers })}
          />

          <QuestionSource room={room} isHost={isHost} onChange={(set) => update({ set })} />

          {!s.set && (
            <Setting label="Брой въпроси">
              <Segmented
                disabled={!isHost || s.rounds}
                value={s.questions}
                onChange={(questions) => update({ questions })}
                options={ROOM_LIMITS.questions.map((n) => ({ value: n, label: n }))}
              />
              {s.rounds && <p className="mt-2 text-xs text-fg-3">Три рунда по три въпроса и финал.</p>}
            </Setting>
          )}

          <Setting label="Време за въпрос">
            <Segmented
              disabled={!isHost}
              value={s.timeMs}
              onChange={(timeMs) => update({ timeMs })}
              options={ROOM_LIMITS.timeMs.map((ms) => ({ value: ms, label: `${ms / 1000} с` }))}
            />
          </Setting>

          {!s.set && (
            <Setting label="Категории">
              <Segmented
                disabled={!isHost}
                value={categoryMode}
                onChange={(mode) =>
                  update(
                    mode === 'one'
                      ? { category: s.category === 'mixed' ? CATEGORIES[0].id : s.category, rounds: false }
                      : { category: 'mixed', rounds: mode === 'rounds' },
                  )
                }
                options={[
                  { value: 'mixed', label: 'Микс' },
                  { value: 'rounds', label: 'Избира последният' },
                  { value: 'one', label: 'Една' },
                ]}
              />
              <p className="mt-2 text-xs text-fg-3">
                {categoryMode === 'mixed'
                  ? 'По малко от всичко.'
                  : categoryMode === 'rounds'
                    ? 'Преди всеки рунд последният по точки избира категорията от три.'
                    : 'Всички въпроси от една категория:'}
              </p>
              {categoryMode === 'one' && (
                <select
                  aria-label="Категория"
                  disabled={!isHost}
                  value={s.category}
                  onChange={(e) => update({ category: e.target.value as CategoryChoice })}
                  className="field mt-2 h-11 w-full rounded-2xl pr-10 pl-3 text-sm disabled:opacity-70"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id} className="bg-ink-2">
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Setting>
          )}

          {!s.set && (
            <Toggle
              checked={s.final}
              disabled={!isHost}
              onChange={(final) => update({ final })}
              icon={<Target className="size-4 text-amber-300" />}
              title="Финал с число"
              hint="Последният въпрос е число за въвеждане — година, височина, брой"
            />
          )}

          {!s.set && (
            <Toggle
              checked={s.pictures}
              disabled={!isHost}
              onChange={(pictures) => update({ pictures })}
              icon={<ImageIcon className="size-4 text-emerald-300" />}
              title="Картини"
              hint="Въпроси със снимка: знамена, места, картини, животни (докъдето стигнат — после обикновени)"
            />
          )}

          <Toggle
            checked={!s.hostPlays}
            disabled={!isHost}
            onChange={(presenting) => update({ hostPlays: !presenting })}
            icon={<Presentation className="size-4 text-fuchsia-300" />}
            title="Само водя"
            hint="Играта е на твоя екран (проектор, телевизор), а играчите отговарят от телефоните си"
          />

          <Toggle
            checked={s.teams}
            disabled={!isHost}
            onChange={(teams) => update({ teams })}
            icon={<Users className="size-4 text-sky-300" />}
            title="Отбори"
            hint="2 отбора, точките се събират"
          />

          <Toggle
            checked={s.elimination}
            disabled={!isHost || s.teams || (crowded && !s.elimination)}
            onChange={(elimination) => update({ elimination })}
            icon={<Skull className="size-4 text-rose-300" />}
            title="Елиминации"
            hint={
              s.teams
                ? 'Не важи при отборен мач'
                : crowded
                  ? `До ${ROOM_LIMITS.eliminationPlayers} играчи`
                  : `Последният отпада на всеки няколко въпроса (до ${ROOM_LIMITS.eliminationPlayers} играчи)`
            }
          />
        </Card>
      </div>

      {/* Waiting for the host is time to read what the козове do (the countdown only names them). */}
      <FreshPowerupNotes />

      {/* Phones and tablets: the start (or the wait) stays in view above the tab bar instead of under all the settings. */}
      <div
        className={clsx(
          // The tab bar steps aside in a room: the bar sits at the very bottom, clear of the home indicator.
          'sticky bottom-0 z-30 -mx-4 flex items-center gap-3 cramped:static border-t border-line bg-ink/85 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:-mx-6 sm:px-6 lg:hidden',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Играчи {room.players.length}/{s.maxPlayers}
          </p>
          <p className="text-xs text-fg-3">
            {isHost ? (startHint ?? 'Всичко е готово за старт.') : 'Чакаме домакина да започне…'}
          </p>
        </div>
        {isHost && (
          <Button size="lg" className="shrink-0" onClick={start} loading={starting} disabled={!canStart}>
            <Play className="size-5" /> Започни
          </Button>
        )}
      </div>

      <Modal open={!!kickTarget} onClose={() => setKicking(null)} title="Премахване от стаята">
        <p className="text-fg-2">
          Да премахна ли <b className="text-fg [overflow-wrap:anywhere]">{kickTarget?.name}</b> от стаята? Ще може да се
          върне само с нова покана от теб.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setKicking(null)}>
            Отказ
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (kickTarget) actions.roomKick(kickTarget.id);
              setKicking(null);
            }}
          >
            <UserMinus className="size-4" /> Премахни
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Where the questions come from: the bank (АЛМАНАХ), or one of the host's own sets („Моите въпроси“) — all of it, in
 * its order. The others see which.
 */
function QuestionSource({
  room,
  isHost,
  onChange,
}: {
  room: RoomState;
  isHost: boolean;
  onChange: (setId: number | null) => void;
}) {
  const guest = useStore((s) => !!s.me?.isGuest);
  const { data } = useLoad(() => (isHost && !guest ? api.sets() : Promise.resolve(null)), String(isHost));
  const current = room.settings.set;
  const playable = (data?.sets ?? []).filter((x) => x.questions > 0 && !x.hidden);
  return (
    <Setting label="Въпроси">
      {isHost && !guest ? (
        <select
          aria-label="Въпроси"
          value={current?.id ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          className="field h-11 w-full rounded-2xl pr-10 pl-3 text-sm"
        >
          <option value="" className="bg-ink-2">
            От АЛМАНАХ
          </option>
          {playable.map((x) => (
            <option key={x.id} value={x.id} className="bg-ink-2">
              📝 {x.name} ({x.questions})
            </option>
          ))}
        </select>
      ) : (
        <p className="text-sm text-fg-2">{current ? `📝 „${current.name}“ на домакина` : 'От АЛМАНАХ'}</p>
      )}
      <p className="mt-2 text-xs text-fg-3">
        {current
          ? `Всичките ${current.questions} въпроса, в реда на набора. Без XP за отговорите: въпросите са на домакина.`
          : 'Или твои въпроси: '}
        {!current && isHost && !guest && (
          <Link to="/sets" className="font-semibold text-violet-300 hover:underline">
            Моите въпроси →
          </Link>
        )}
      </p>
    </Setting>
  );
}

/** How many the room takes: a slider for big jumps (a class), buttons for one more or less. */
function MaxPlayers({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-semibold tracking-wide text-fg-2 uppercase">
        Максимум играчи
      </label>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          aria-label="По-малко"
          disabled={disabled || value <= min}
          onClick={() => onChange(value - 1)}
        >
          <Minus className="size-4" />
        </Button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          value={Math.min(Math.max(value, min), max)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-0 flex-1 accent-violet-400 disabled:opacity-60"
        />
        <Button
          variant="secondary"
          aria-label="Повече"
          disabled={disabled || value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="size-4" />
        </Button>
        <span aria-hidden className="w-8 text-center font-display text-xl font-bold tabular-nums">
          {value}
        </span>
      </div>
    </div>
  );
}

/** A setting's name over its control; a fieldset, so the choices inside it are announced with the name. */
function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-semibold tracking-wide text-fg-2 uppercase">{label}</legend>
      {children}
    </fieldset>
  );
}

/** A room setting the host switches on or off: the whole row is the switch, named by its title. */
function Toggle({
  checked,
  disabled,
  onChange,
  icon,
  title,
  hint,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'focus-ring flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left',
        disabled ? 'cursor-not-allowed' : 'hover:bg-tint/5',
        disabled && !checked && 'opacity-60',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 text-sm">
        <b id={`${id}-title`}>{title}</b>
        <span id={`${id}-hint`} className="block text-xs text-fg-3">
          {hint}
        </span>
      </span>
      <SwitchTrack on={checked} />
    </button>
  );
}

// ─── Players ───────────────────────────────────────────────────────────────

// A 44px target that takes only 32px of the row (the rest overlaps the card's padding), so names keep their room.
const SEAT_BUTTON = 'focus-ring -m-1.5 grid size-11 shrink-0 place-items-center rounded-xl text-fg-3';

function PlayerCard({
  p,
  meId,
  isHost,
  teamButton,
  onKick,
  presenting,
}: {
  p: RoomPlayer;
  meId: number;
  isHost: boolean;
  teamButton?: React.ReactNode;
  onKick: (p: RoomPlayer) => void;
  /** The host runs the game on a big screen („Само водя“) and doesn't play. */
  presenting?: boolean;
}) {
  const kickable = isHost && !p.isHost;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={clsx(
        'flex items-center gap-2.5 rounded-2xl border border-line bg-tint/[0.04] p-2.5 sm:gap-3 sm:p-3',
        p.id === `u${meId}` && 'border-violet-400/40 bg-violet-500/10',
      )}
    >
      {/* Bots are marked on the avatar: rows here also hold the host's buttons, and a chip by the name would squeeze it out. */}
      <Avatar avatar={p.avatar} frame={p.frame} size={44}>
        {p.isBot && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md bg-ink-2 px-1 text-xs leading-3.5 font-bold tracking-wide text-fg-2 ring-1 ring-line">
            БОТ
          </span>
        )}
      </Avatar>
      <div className={clsx('min-w-0 flex-1 text-sm', presenting && 'opacity-70')}>
        {presenting ? (
          <>
            <p className="truncate font-semibold">{p.name}</p>
            <p className="truncate text-xs text-fuchsia-300">Води на голям екран · не играе</p>
          </>
        ) : (
          <PlayerTag name={p.name} title={p.title} level={p.level} />
        )}
        {p.isBot && <span className="sr-only">бот</span>}
      </div>
      {p.isHost && <Crown className="size-4 shrink-0 text-amber-300" aria-label="Домакин" />}
      {(teamButton || kickable) && (
        <div className="flex shrink-0 items-center gap-2.5">
          {teamButton}
          {/* Keep "move" and the destructive "remove" apart. */}
          {teamButton && kickable && <span aria-hidden className="h-6 w-px bg-line" />}
          {kickable && (
            <button
              type="button"
              onClick={() => onKick(p)}
              aria-label={`Премахни ${p.name}`}
              title="Премахни от стаята"
              className={clsx(SEAT_BUTTON, 'hover:bg-rose-500/15 hover:text-rose-300')}
            >
              <UserMinus className="size-4" />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** All the empty seats as one tile, instead of a column of "free" placeholders. */
function FreeSeats({ count, className }: { count: number; className?: string }) {
  return (
    <motion.div
      layout
      className={clsx(
        'grid place-items-center rounded-2xl border border-dashed border-line px-3 text-center text-sm text-fg-3',
        className,
      )}
    >
      Още {plural(count, 'свободно място', 'свободни места')}
    </motion.div>
  );
}

function Seats({
  room,
  meId,
  isHost,
  onKick,
}: {
  room: RoomState;
  meId: number;
  isHost: boolean;
  onKick: (p: RoomPlayer) => void;
}) {
  const free = room.settings.maxPlayers - room.players.length;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2">
      <AnimatePresence initial={false}>
        {room.players.map((p) => (
          <PlayerCard
            key={p.id}
            p={p}
            meId={meId}
            isHost={isHost}
            onKick={onKick}
            presenting={p.isHost && !room.settings.hostPlays}
          />
        ))}
      </AnimatePresence>
      {free > 0 && <FreeSeats count={free} className="min-h-[70px]" />}
    </div>
  );
}

function TeamColumns({
  room,
  meId,
  isHost,
  onKick,
}: {
  room: RoomState;
  meId: number;
  isHost: boolean;
  onKick: (p: RoomPlayer) => void;
}) {
  const free = room.settings.maxPlayers - room.players.length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 2xl:grid-cols-2">
        {([0, 1] as TeamId[]).map((team) => {
          const color = teamColor(team);
          const members = room.players.filter((p) => p.team === team);
          const other = TEAMS[team === 0 ? 1 : 0].name;
          return (
            <div
              key={team}
              className="rounded-2xl border p-2 sm:p-2.5"
              style={{ borderColor: `${color}44`, background: `${color}0d` }}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="size-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
                <span className="text-sm font-extrabold" style={{ color }}>
                  {TEAMS[team].name}
                </span>
                <span className="ml-auto text-xs font-semibold text-fg-3">{members.length}</span>
              </div>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {members.map((p) => (
                    <PlayerCard
                      key={p.id}
                      p={p}
                      meId={meId}
                      isHost={isHost}
                      onKick={onKick}
                      presenting={p.isHost && !room.settings.hostPlays}
                      teamButton={
                        isHost && (
                          <button
                            type="button"
                            onClick={() => actions.roomTeam(p.id)}
                            title={`Премести при ${other}`}
                            aria-label={`Премести ${p.name} при ${other}`}
                            className={clsx(SEAT_BUTTON, 'hover:bg-tint/10 hover:text-fg')}
                          >
                            <ArrowLeftRight className="size-4" />
                          </button>
                        )
                      }
                    />
                  ))}
                </AnimatePresence>
                {members.length === 0 && (
                  <div className="grid h-[70px] place-items-center rounded-2xl border border-dashed border-line text-sm text-fg-3">
                    Празен отбор
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {free > 0 && <FreeSeats count={free} className="h-12" />}
    </div>
  );
}

// ─── Invite friends ────────────────────────────────────────────────────────

function InviteFriends({ room }: { room: RoomState }) {
  const version = useStore((s) => s.friendsVersion);
  const { data, error, retry } = useLoad(() => api.friends(), '', version);
  const friends = data?.friends ?? null;
  const [sent, setSent] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState<number | null>(null);

  async function invite(userId: number) {
    setSending(userId);
    const res = await actions.invite(userId);
    setSending(null);
    if (!res.ok) {
      toast({ kind: 'error', title: res.error });
      return;
    }
    toast({ kind: 'success', title: 'Поканата е изпратена' });
    setSent((s) => new Set(s).add(userId));
    setTimeout(
      () =>
        setSent((s) => {
          const next = new Set(s);
          next.delete(userId);
          return next;
        }),
      15_000,
    );
  }

  const online = friends?.filter((f) => f.presence !== 'offline') ?? [];

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="t-card">Покани приятели</h2>
        <Link
          to="/friends"
          className="focus-ring -my-2.5 inline-flex min-h-11 shrink-0 items-center rounded-lg text-sm font-semibold whitespace-nowrap text-violet-300 hover:text-violet-200"
        >
          Приятели →
        </Link>
      </div>
      {friends === null ? (
        error ? (
          <LoadError compact title="Приятелите не се заредиха" error={error} onRetry={retry} />
        ) : (
          <div className="grid place-items-center py-6">
            <Spinner className="size-6 text-violet-400" />
          </div>
        )
      ) : friends.length === 0 ? (
        <p className="text-sm text-fg-3">
          Още нямаш приятели в играта — прати им линка с „Покани“ горе.{' '}
          <Link to="/friends" className="font-semibold text-violet-300 hover:text-violet-200">
            Добави приятели
          </Link>
          , за да ги каниш направо оттук.
        </p>
      ) : online.length === 0 ? (
        <p className="text-sm text-fg-3">
          Никой от приятелите ти не е онлайн в момента. Прати им линка с „Покани“ горе.
        </p>
      ) : (
        <ul className="space-y-2">
          {online.map((f) => {
            const inRoom = room.players.some((p) => p.id === `u${f.user.id}`);
            const wasSent = sent.has(f.user.id);
            return (
              <li
                key={f.user.id}
                className="flex items-center gap-3 rounded-2xl border border-line bg-tint/[0.03] p-2.5"
              >
                <Avatar avatar={f.user.avatar} frame={f.user.frame} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{f.user.username}</div>
                  <div className="flex items-center gap-1.5 text-xs text-fg-3">
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full"
                      style={{ background: PRESENCE[f.presence].color }}
                    />
                    {PRESENCE[f.presence].label}
                  </div>
                </div>
                {inRoom ? (
                  <span className="text-xs font-semibold text-emerald-300">В стаята</span>
                ) : (
                  <Button
                    size="sm"
                    variant={wasSent ? 'ghost' : 'secondary'}
                    disabled={wasSent}
                    loading={sending === f.user.id}
                    onClick={() => invite(f.user.id)}
                  >
                    {wasSent ? (
                      <>
                        <Check className="size-4" /> Изпратено
                      </>
                    ) : (
                      <>
                        <Send className="size-4" /> Покани
                      </>
                    )}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
