import { actions, api, fmt, toast, useNow, useStore } from '@quiz/client';
import { EVENING, type EveningStatus, MODES } from '@quiz/shared';
import clsx from 'clsx';
import { ChevronDown, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLoad } from '../../lib/load';
import { Avatar } from '../Avatar';
import { Emoji } from '../Emoji';
import { PlayerName } from '../FitName';
import { Button, Card } from '../ui';
import { countdown } from './time';

const waitingText = (n: number) => (n === 0 ? 'още никой не чака' : n === 1 ? '1 чака' : `${n} чакат`);

/**
 * „Вечерен Роял“ on the home page: when tonight's starts (its lobby open from five minutes before, with how many wait),
 * and last night's top until the next one.
 */
export function EveningCard({ className, compact = false }: { className?: string; compact?: boolean }) {
  const now = useNow(1000);
  const live = useStore((s) => s.evening);
  // Loaded afresh when the lobby opens or a match ends (the next evening's times change then).
  const { data, retry } = useLoad(() => api.evening());
  const status: EveningStatus | null =
    live && data?.status && live.day === data.status.day ? live : (data?.status ?? null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const opening = !!status && now >= status.opensAt && now < status.startsAt;
  const over = !!status && now >= status.startsAt && !status.live;
  useEffect(() => {
    if (over) retry();
  }, [over, retry]);
  if (!data || (!status && !data.lastNight)) return null;
  // Away from the evening (the home page puts it under the rest then): a line saying when, no clock ticking a day away.
  const quiet = compact && !opening && !status?.joined && !status?.live;
  const night = data.lastNight;
  const [a, b] = MODES.evening.accent;

  async function join() {
    setBusy(true);
    const res = await actions.joinEvening();
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
    else retry();
  }

  const at = status && new Date(status.startsAt).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  return (
    <Card className={clsx('relative overflow-hidden', quiet ? 'p-4' : 'p-5 sm:p-6', className)}>
      <div
        aria-hidden
        className="absolute inset-0 opacity-20"
        style={{
          background: `radial-gradient(90% 120% at 100% 0%, ${a}, transparent 60%), radial-gradient(70% 90% at 0% 100%, ${b}66, transparent 70%)`,
        }}
      />
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3">
        <Moon aria-hidden className={clsx('shrink-0 text-indigo-300', quiet ? 'size-6' : 'size-8')} />
        <div className="min-w-0 flex-1 basis-52">
          <h2 className="t-card">{MODES.evening.name}</h2>
          {/* The countdown ticks every second: it stays out of the live line below, which says only what changed. */}
          <p className="text-sm text-fg-2">
            {!status
              ? 'Утре пак, в 21:00.'
              : status.live
                ? 'Тече в момента.'
                : status.joined
                  ? `Вътре си · ${waitingText(status.waiting)} · започва след ${countdown(status.startsAt - now)}`
                  : opening
                    ? `Входът е отворен · ${waitingText(status.waiting)} · започва след ${countdown(status.startsAt - now)}`
                    : quiet
                      ? `Всяка вечер в ${at}, до ${EVENING.maxPlayers} души. Входът се отваря ${EVENING.lobbyMinutes} минути преди това.`
                      : `Всяка вечер в ${at}, до ${EVENING.maxPlayers} души. Входът се отваря ${EVENING.lobbyMinutes} минути преди това · след ${countdown(status.opensAt - now)}`}
          </p>
          <p className="sr-only" aria-live="polite">
            {status?.live
              ? 'Вечерният Роял започна.'
              : status?.joined
                ? 'Вътре си във вечерния Роял.'
                : opening
                  ? 'Входът за вечерния Роял е отворен.'
                  : ''}
          </p>
        </div>
        {status?.joined ? (
          <Button variant="ghost" onClick={actions.leaveEvening}>
            Излез
          </Button>
        ) : (
          opening && (
            <Button variant="gold" onClick={() => void join()} loading={busy}>
              Влез
            </Button>
          )
        )}
      </div>
      {night && (
        <div className="relative mt-4 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="focus-ring flex w-full items-center gap-2 rounded-lg text-left text-sm"
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="text-fg-3">{night.day === status?.day ? 'Тази вечер' : 'Снощи'}:</span> <Emoji e="👑" />{' '}
              <b>{night.top[0]?.placement === 1 ? night.top[0].user.username : '—'}</b>
              <span className="text-fg-3"> · {night.players} играха</span>
            </span>
            <ChevronDown
              aria-hidden
              className={clsx('size-4 shrink-0 text-fg-3 transition-transform', open && 'rotate-180')}
            />
          </button>
          {open && (
            <ol className="mt-2 space-y-1.5">
              {night.top.map((t) => (
                <li key={t.user.id} className="flex items-center gap-2.5 text-sm">
                  <span className="w-6 text-right text-fg-3 tabular-nums">{t.placement}.</span>
                  <Avatar avatar={t.user.avatar} frame={t.user.frame} size={26} />
                  <PlayerName name={t.user.username} className="flex-1" />
                  <span className="text-fg-2 tabular-nums">{fmt(t.score)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}
