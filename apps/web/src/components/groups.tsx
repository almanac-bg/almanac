import { api, fmt, ordinal, plural, useStore } from '@quiz/client';
import type { GroupSummary } from '@quiz/shared';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { useLoad } from '../lib/load';
import { Emoji } from './Emoji';
import { Card, SectionTitle } from './ui';

/** A group in a list: where you stand this week, and who leads. */
export function GroupRow({ group: g, compact }: { group: GroupSummary; compact?: boolean }) {
  return (
    <Link
      to={`/groups/${g.id}`}
      className={clsx(
        'focus-ring flex items-center gap-4 rounded-3xl transition-colors hover:bg-tint/[0.06]',
        compact ? '-mx-1 gap-3 px-1 py-1.5' : 'glass p-4 sm:px-5',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'grid shrink-0 place-items-center rounded-2xl bg-tint/5',
          compact ? 'size-9 text-xl' : 'size-11 text-2xl',
        )}
      >
        <Emoji e={g.crown ? '👑' : '🫂'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{g.name}</span>
        <span className="block truncate text-sm text-fg-3">
          {g.you ? `${ordinal(g.you.rank)} място` : 'тази седмица още нямаш точки'}
          {g.leader && !g.leader.you && ` · ${g.leader.username} води с ${fmt(g.leader.score)}`}
          {g.leader?.you && ' · водиш!'}
          {!compact && ` · ${plural(g.members, 'член', 'членове')}`}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" />
    </Link>
  );
}

/** The player's groups this week, under the day's questions on the home page (whose scores make the boards). */
export function GroupStandings({ refresh }: { refresh: unknown }) {
  const count = useStore((s) => s.me?.groups ?? 0);
  const { data } = useLoad(() => (count ? api.groups() : Promise.resolve({ groups: [] })), String(count), refresh);
  if (!data?.groups.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-xs font-semibold text-fg-3">Групите ти тази седмица</p>
      <ul className="mt-1">
        {data.groups.map((g) => (
          <li key={g.id}>
            <GroupRow group={g} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The friends page's word on groups: yours, or what one is, with the way to make one. */
export function GroupsSection() {
  const count = useStore((s) => s.me?.groups ?? 0);
  const { data } = useLoad(() => (count ? api.groups() : Promise.resolve({ groups: [] })), String(count));
  return (
    <section>
      <SectionTitle
        aside={
          <Link
            to="/groups"
            className="focus-ring -my-2.5 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-violet-300 hover:text-violet-200"
          >
            {count ? 'Всички групи →' : 'Създай група →'}
          </Link>
        }
      >
        Групи
      </SectionTitle>
      {data?.groups.length ? (
        <ul className="space-y-3">
          {data.groups.map((g) => (
            <li key={g.id}>
              <GroupRow group={g} />
            </li>
          ))}
        </ul>
      ) : (
        <Card className="flex items-center gap-4 p-4 sm:px-5">
          <span aria-hidden className="text-3xl">
            <Emoji e="🫂" />
          </span>
          <p className="min-w-0 flex-1 text-sm text-fg-2">
            Клас, офис, семейство: група с линк за покана и седмична класация на въпросите на деня.
          </p>
        </Card>
      )}
    </section>
  );
}
