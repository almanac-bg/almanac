import { api, fmt } from '@quiz/client';
import type { LaunchStats } from '@quiz/shared';
import { useState } from 'react';
import { useLoad } from '../../lib/load';
import { LoadError } from '../LoadError';
import { Card, Spinner } from '../ui';

type Day = LaunchStats['days'][number];

const v = (d: Day | undefined, metric: string) => d?.values[metric] ?? 0;
const newPlayers = (d: Day | undefined) => v(d, 'signups') + v(d, 'guests');
const matches = (d: Day) => Object.entries(d.values).reduce((sum, [k, n]) => sum + (k.startsWith('matches:') ? (n ?? 0) : 0), 0);
const shortDay = (day: string) => `${Number(day.slice(8))}.${day.slice(5, 7)}`;
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : '—');

/** Share of players who joined on the given cohort days and came back after `after` days (cohorts old enough only). */
function retention(days: Day[], after: number, cohorts: number) {
  const eligible = days.slice(after, after + cohorts); // days[0] is today
  const joined = eligible.reduce((s, d) => s + newPlayers(d), 0);
  const back = eligible.reduce((s, d) => s + v(d, after === 1 ? 'returned_d1' : 'returned_d7'), 0);
  return pct(back, joined);
}

/**
 * Admin → Статистика: is the launch working? Counted on the server as things happen (no tracking, no third parties).
 */
export function LaunchStatsPanel() {
  const { data, error, retry } = useLoad(() => api.adminStats());
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
  const month = days;
  const sum = (list: Day[], metric: string) => list.reduce((s, d) => s + v(d, metric), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Активни днес" value={fmt(v(days[0], 'active'))} hint={`вчера ${fmt(v(days[1], 'active'))}`} />
        <Tile label="Нови за 7 дни" value={fmt(week.reduce((s, d) => s + newPlayers(d), 0))} hint={`${fmt(sum(week, 'guests'))} като гости`} />
        <Tile label="Гости → профил" value={pct(sum(month, 'claims'), sum(month, 'guests'))} hint="запазени гост-профили, 30 дни" />
        <Tile
          label="Връщат се"
          value={retention(days, 1, 14)}
          hint={`на следващия ден · ${retention(days, 7, 14)} след седмица`}
        />
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="font-display text-lg font-bold">Активни играчи на ден</h2>
        <p className="text-sm text-fg-3">
          Изиграли поне един мач · последните 30 дни · общо {fmt(totals.accounts)} профила, {fmt(totals.guests)} гости, {fmt(totals.matches)} мача
        </p>
        <ActiveChart days={[...days].reverse()} />
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm tabular-nums">
            <caption className="sr-only">Статистика по дни</caption>
            <thead className="text-left text-xs tracking-wide text-fg-3 uppercase">
              <tr className="border-b border-line">
                {['Ден', 'Активни', 'Профили', 'Гости', 'Запазени', 'Мачове', 'Предизвик.', 'Дневно', 'Ден 2', 'Ден 8'].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-semibold first:pl-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.slice(0, 14).map((d, i) => (
                <tr key={d.day} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2.5 pl-5 text-left font-semibold">
                    {i === 0 ? 'Днес' : shortDay(d.day)}
                  </th>
                  <td className="px-4 py-2.5">{fmt(v(d, 'active'))}</td>
                  <td className="px-4 py-2.5">{fmt(v(d, 'signups'))}</td>
                  <td className="px-4 py-2.5">{fmt(v(d, 'guests'))}</td>
                  <td className="px-4 py-2.5">{fmt(v(d, 'claims'))}</td>
                  <td className="px-4 py-2.5">{fmt(matches(d))}</td>
                  <td className="px-4 py-2.5">
                    {fmt(v(d, 'challenges'))} / {fmt(v(d, 'challenge_runs'))}
                  </td>
                  <td className="px-4 py-2.5">{fmt(v(d, 'daily_runs'))}</td>
                  {/* Returns are only known once the day after (or the week after) has come. */}
                  <td className="px-4 py-2.5 text-fg-2">{i >= 1 ? pct(v(d, 'returned_d1'), newPlayers(d)) : '—'}</td>
                  <td className="px-4 py-2.5 text-fg-2">{i >= 7 ? pct(v(d, 'returned_d7'), newPlayers(d)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-fg-3">
          „Предизвик.“: създадени линкове / изиграни. „Ден 2“ и „Ден 8“: от новите играчи през деня, колко са играли пак на
          следващия ден и седмица по-късно.
        </p>
      </Card>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-xs font-semibold tracking-wide text-fg-3 uppercase">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-fg-3">{hint}</p>
    </Card>
  );
}

/** One bar per day, oldest left. Hover (or tap) a day for its number; the table below has them all. */
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
        className="relative flex h-40 items-end gap-0.5 border-b border-white/15"
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive guide at the top value. */}
        <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-white/10" />
        <span className="pointer-events-none absolute -top-2.5 right-0 bg-ink-2 pl-1 text-[11px] text-fg-3 tabular-nums">{fmt(max)}</span>
        {values.map((n, i) => (
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
      <figcaption className="mt-1.5 flex justify-between text-[11px] text-fg-3">
        <span>{shortDay(days[0].day)}</span>
        <span>днес</span>
      </figcaption>
    </figure>
  );
}
