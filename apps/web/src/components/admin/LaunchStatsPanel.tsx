import { api, fmt } from '@quiz/client';
import { type LaunchStats, MODES, type ModeId } from '@quiz/shared';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useLoad } from '../../lib/load';
import { LoadError } from '../LoadError';
import { Card, Spinner } from '../ui';

type Day = LaunchStats['days'][number];

const v = (d: Day | undefined, metric: string) => d?.values[metric] ?? 0;
const newPlayers = (d: Day | undefined) => v(d, 'signups') + v(d, 'guests');
const matches = (d: Day) =>
  Object.entries(d.values).reduce((sum, [k, n]) => sum + (k.startsWith('matches:') ? (n ?? 0) : 0), 0);
const shortDay = (day: string) => `${Number(day.slice(8))}.${day.slice(5, 7)}`;
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : '—');

/**
 * Of the players who joined on cohort days old enough and finished a first match ("starters"), the share that played
 * again `after` days later. `days[0]` is today; the cohorts are the `cohorts` days from `after` days ago back.
 */
function retention(days: Day[], after: 1 | 7 | 30, cohorts: number) {
  const eligible = days.slice(after, after + cohorts);
  const started = eligible.reduce((s, d) => s + v(d, 'starters'), 0);
  const back = eligible.reduce((s, d) => s + v(d, `returned_d${after}`), 0);
  return pct(back, started);
}

const LINKS: { kind: string; label: string; uses: string }[] = [
  { kind: 'challenge', label: 'Предизвикателства', uses: 'изиграни' },
  { kind: 'daily', label: 'Въпросите на деня', uses: 'изиграни' },
  { kind: 'group', label: 'Покани в група', uses: 'влезли' },
  { kind: 'set', label: 'Споделени набори', uses: 'копирани' },
];

const EMAIL_EVENTS: Record<string, string> = {
  email_dropped: 'Неизпратени',
  email_mailbox_not_found: 'Несъществуващ адрес',
  email_spam: 'Отбелязани като спам',
  email_blocklisted: 'В черен списък',
};

/**
 * Admin → Статистика: is the launch working? Counted on the server as things happen (no tracking, no third parties).
 */
export function LaunchStatsPanel() {
  const { data, error, retry } = useLoad(() => api.adminStats());
  const [table, moreRight] = useMoreToTheRight(!!data);
  if (error && !data) return <LoadError title="Статистиката не се зареди" error={error} onRetry={retry} />;
  if (!data) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="size-7 text-violet-400" />
      </div>
    );
  }
  const { days, totals } = data;
  const week = days.slice(0, 7);
  const month = days.slice(0, 30);
  const sum = (list: Day[], metric: string) => list.reduce((s, d) => s + v(d, metric), 0);
  const sumPrefix = (list: Day[], prefix: string) => {
    const totalsBy = new Map<string, number>();
    for (const d of list)
      for (const [k, n] of Object.entries(d.values))
        if (k.startsWith(prefix))
          totalsBy.set(k.slice(prefix.length), (totalsBy.get(k.slice(prefix.length)) ?? 0) + (n ?? 0));
    return totalsBy;
  };
  // The funnel's later steps only for those who had the time: a return the day after needs a day gone by.
  const newIn = month.reduce((s, d) => s + newPlayers(d), 0);
  const modes = [...sumPrefix(month, 'matches:')].sort((a, b) => b[1] - a[1]);
  const emails = [...sumPrefix(month, 'email_events:')];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Активни днес" value={fmt(v(days[0], 'active'))} hint={`вчера ${fmt(v(days[1], 'active'))}`} />
        <Tile
          label="Нови за 7 дни"
          value={fmt(week.reduce((s, d) => s + newPlayers(d), 0))}
          hint={`${fmt(sum(week, 'guests'))} като гости`}
        />
        <Tile
          label="Гости → профил"
          value={pct(sum(month, 'claims'), sum(month, 'guests'))}
          hint="запазени гост-профили, 30 дни"
        />
        <Tile
          label="Връщат се"
          value={retention(days, 1, 14)}
          hint={`на следващия ден · ${retention(days, 7, 14)} след седмица · ${retention(days, 30, 14)} след месец`}
        />
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="t-card">Активни играчи на ден</h2>
        <p className="text-sm text-fg-3">
          Изиграли поне един мач · последните 30 дни · общо {fmt(totals.accounts)} профила, {fmt(totals.guests)} гости,{' '}
          {fmt(totals.matches)} мача
        </p>
        <ActiveChart days={[...month].reverse()} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <h2 className="t-card">Пътят на новите играчи</h2>
          <p className="text-sm text-fg-3">Дошлите през последните 30 дни: колко стигат до всяка стъпка.</p>
          <Bars
            rows={[
              { label: 'Дошли (профил или гост)', value: newIn },
              { label: 'Изиграли мач до край', value: sum(month, 'starters') },
              { label: 'Играли пак на следващия ден', value: sum(month.slice(1), 'returned_d1') },
              { label: 'Играли пак след седмица', value: sum(month.slice(7), 'returned_d7') },
              { label: 'Запазили гост-профила', value: sum(month, 'claims') },
            ]}
            of={newIn}
          />
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="t-card">Мачове по режими</h2>
          <p className="text-sm text-fg-3">Последните 30 дни.</p>
          <Bars
            rows={modes.map(([mode, n]) => ({ label: MODES[mode as ModeId]?.name ?? mode, value: n }))}
            of={modes.reduce((s, [, n]) => s + n, 0)}
            empty="Още няма мачове."
          />
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="t-card">Линкове</h2>
          <p className="text-sm text-fg-3">Отворени от някой друг и използвани, последните 30 дни.</p>
          <dl className="mt-4 space-y-2 text-sm">
            {LINKS.map((l) => {
              const opens = sum(month, `link_opens:${l.kind}`);
              const uses = sum(month, `link_uses:${l.kind}`);
              return (
                <div key={l.kind} className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="text-fg-2">{l.label}</dt>
                  <dd className="tabular-nums">
                    <b>{fmt(opens)}</b> отворени · <b>{fmt(uses)}</b> {l.uses}{' '}
                    <span className="text-fg-3">({pct(uses, opens)})</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="t-card">Въпросите на деня и имейлите</h2>
          <p className="text-sm text-fg-3">Последните 30 дни.</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-fg-2">Започнати / довършени дневни</dt>
              <dd className="tabular-nums">
                <b>{fmt(sum(month, 'daily_runs'))}</b> / <b>{fmt(sum(month, 'daily_finished'))}</b>{' '}
                <span className="text-fg-3">({pct(sum(month, 'daily_finished'), sum(month, 'daily_runs'))})</span>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-fg-2">Напомняния за серия</dt>
              <dd className="font-bold tabular-nums">{fmt(sum(month, 'reminders'))}</dd>
            </div>
            {emails.length === 0 ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-fg-2">Неполучени имейли</dt>
                <dd className="font-bold">0</dd>
              </div>
            ) : (
              emails.map(([kind, n]) => (
                <div key={kind} className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="text-fg-2">{EMAIL_EVENTS[kind] ?? kind}</dt>
                  <dd className="font-bold text-amber-300 tabular-nums">{fmt(n)}</dd>
                </div>
              ))
            )}
          </dl>
        </Card>
      </div>

      {/* On a phone the table scrolls sideways: the day stays put, and a fade says there's more to the right. */}
      <Card className="overflow-hidden">
        <div className="relative">
          <div ref={table} className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm tabular-nums">
              <caption className="sr-only">Статистика по дни</caption>
              <thead className="text-left text-xs tracking-wide text-fg-3 uppercase">
                <tr className="border-b border-line">
                  {[
                    'Ден',
                    'Активни',
                    'Профили',
                    'Гости',
                    'Изиграли',
                    'Запазени',
                    'Мачове',
                    'Дневно',
                    'Факти',
                    'Ден 2',
                    'Ден 8',
                    'Ден 31',
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-3 font-semibold first:sticky first:left-0 first:bg-ink-2 first:pl-5"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.slice(0, 14).map((d, i) => (
                  <tr key={d.day} className="border-b border-line last:border-0">
                    <th scope="row" className="sticky left-0 bg-ink-2 px-4 py-2.5 pl-5 text-left font-semibold">
                      {i === 0 ? 'Днес' : shortDay(d.day)}
                    </th>
                    <td className="px-4 py-2.5">{fmt(v(d, 'active'))}</td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'signups'))}</td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'guests'))}</td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'starters'))}</td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'claims'))}</td>
                    <td className="px-4 py-2.5">{fmt(matches(d))}</td>
                    <td className="px-4 py-2.5">
                      {fmt(v(d, 'daily_runs'))} / {fmt(v(d, 'daily_finished'))}
                    </td>
                    {/* Stops to read a "Знаеше ли?" (Solo, the daily): whether the facts are worth writing. */}
                    <td className="px-4 py-2.5">{fmt(v(d, 'fact_holds'))}</td>
                    {/* Returns are only known once the day after (the week, the month after) has come. */}
                    <td className="px-4 py-2.5 text-fg-2">
                      {i >= 1 ? pct(v(d, 'returned_d1'), v(d, 'starters')) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-fg-2">
                      {i >= 7 ? pct(v(d, 'returned_d7'), v(d, 'starters')) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-fg-2">—</td>
                  </tr>
                ))}
                {days.length > 30 && (
                  <tr className="border-b border-line">
                    <th
                      scope="rowgroup"
                      colSpan={12}
                      className="sticky left-0 bg-ink-2 px-5 pt-4 pb-2 text-left text-xs font-semibold tracking-wide text-fg-3 uppercase"
                    >
                      Отпреди месец — за „Ден 31“
                    </th>
                  </tr>
                )}
                {days.slice(30, 44).map((d) => (
                  <tr key={d.day} className="border-b border-line last:border-0 text-fg-3">
                    <th scope="row" className="sticky left-0 bg-ink-2 px-4 py-2.5 pl-5 text-left font-semibold">
                      {shortDay(d.day)}
                    </th>
                    <td className="px-4 py-2.5">{fmt(v(d, 'active'))}</td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'signups'))}</td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'guests'))}</td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'starters'))}</td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'claims'))}</td>
                    <td className="px-4 py-2.5">{fmt(matches(d))}</td>
                    <td className="px-4 py-2.5">
                      {fmt(v(d, 'daily_runs'))} / {fmt(v(d, 'daily_finished'))}
                    </td>
                    <td className="px-4 py-2.5">{fmt(v(d, 'fact_holds'))}</td>
                    <td className="px-4 py-2.5">{pct(v(d, 'returned_d1'), v(d, 'starters'))}</td>
                    <td className="px-4 py-2.5">{pct(v(d, 'returned_d7'), v(d, 'starters'))}</td>
                    <td className="px-4 py-2.5 text-fg-2">{pct(v(d, 'returned_d30'), v(d, 'starters'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            aria-hidden
            className={clsx(
              'pointer-events-none absolute inset-y-0 right-0 w-12 bg-linear-to-l from-ink-2 transition-opacity',
              moreRight ? 'opacity-100' : 'opacity-0',
            )}
          />
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-fg-3">
          Последните две седмици, после двете седмици отпреди месец (за „Ден 31“). „Изиграли“: новите от деня, които
          довършиха мач. „Ден 2“, „Ден 8“, „Ден 31“: колко от тях играха пак на следващия ден, седмица и месец по-късно.
          „Дневно“: започнати / довършени.
        </p>
      </Card>
    </div>
  );
}

/** Horizontal bars, each with its label and number (and its share of `of`): a funnel or a split. */
function Bars({ rows, of, empty }: { rows: { label: string; value: number }[]; of: number; empty?: string }) {
  if (rows.length === 0) return <p className="mt-4 text-sm text-fg-3">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="mt-4 space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-fg-2">{r.label}</span>
            <span className="tabular-nums">
              <b>{fmt(r.value)}</b> <span className="text-fg-3">{pct(r.value, of)}</span>
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-tint/5">
            <div
              className="h-full rounded-full bg-violet-500"
              style={{ width: `${(100 * r.value) / max}%`, minWidth: r.value ? 4 : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A sideways-scrolling box and whether more of it is hidden to the right (checked again on scroll and on resize). */
function useMoreToTheRight(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const box = ref.current;
    if (!ready || !box) return;
    const check = () => setMore(box.scrollLeft + box.clientWidth < box.scrollWidth - 1);
    check();
    box.addEventListener('scroll', check, { passive: true });
    const resized = new ResizeObserver(check);
    resized.observe(box);
    return () => {
      box.removeEventListener('scroll', check);
      resized.disconnect();
    };
  }, [ready]);
  return [ref, more] as const;
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="t-eyebrow text-fg-3">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-fg-3">{hint}</p>
    </Card>
  );
}

/** One bar per day, oldest left. Hover (or tap) a day for its number; the table below has the last two weeks. */
function ActiveChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map((d) => v(d, 'active'));
  const max = Math.max(1, ...values);
  const shown = hover ?? values.length - 1;
  return (
    <figure className="mt-5">
      <div className="mb-2 flex h-5 items-baseline gap-2 text-sm">
        <span className="font-bold tabular-nums">{fmt(values[shown])}</span>
        <span className="text-fg-3">{shown === values.length - 1 ? 'днес' : shortDay(days[shown].day)}</span>
      </div>
      <div
        role="img"
        aria-label={`Активни играчи на ден за последните ${days.length} дни: днес ${values.at(-1)}, най-много ${max}.`}
        className="relative flex h-40 items-end gap-0.5 border-b border-tint/15"
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive guide at the top value. */}
        <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-tint/10" />
        <span className="pointer-events-none absolute -top-2.5 right-0 bg-ink-2 pl-1 text-xs text-fg-3 tabular-nums">
          {fmt(max)}
        </span>
        {values.map((n, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: a hover readout only; the chart is a labelled image
          <div
            key={days[i].day}
            className="flex h-full flex-1 cursor-default items-end"
            onMouseEnter={() => setHover(i)}
            onTouchStart={() => setHover(i)}
          >
            <div
              className={`w-full rounded-t-[4px] transition-opacity ${hover === null || hover === i ? 'opacity-100' : 'opacity-50'}`}
              style={{ height: `${Math.max(n ? 2 : 0, (100 * n) / max)}%`, background: '#8b5cf6' }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-1.5 flex justify-between text-xs text-fg-3">
        <span>{shortDay(days[0].day)}</span>
        <span>днес</span>
      </figcaption>
    </figure>
  );
}
