import { ACHIEVEMENTS, type AchievementProgress, AVATARS, EMOTES, FRAMES, RARITIES, TITLES } from '@quiz/shared';
import clsx from 'clsx';
import { Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { LoadError } from '../components/LoadError';
import { Card, ProgressBar, Segmented, Spinner } from '../components/ui';
import { api, fmt, longDate } from '@quiz/client';
import { useLoad } from '../lib/load';

type Filter = 'all' | 'unlocked' | 'locked';

/** Cosmetics an achievement unlocks, for the "награда" line. */
function rewardsFor(id: string): string[] {
  const out: string[] = [];
  for (const a of AVATARS) if ('achievement' in a.req && a.req.achievement === id) out.push(`${a.emoji} аватар`);
  for (const f of FRAMES) if ('achievement' in f.req && f.req.achievement === id) out.push(`рамка „${f.name}“`);
  for (const t of TITLES) if ('achievement' in t.req && t.req.achievement === id) out.push(`титла „${t.name}“`);
  for (const e of EMOTES) if ('achievement' in e.req && e.req.achievement === id) out.push(`${e.emoji} емоция`);
  return out;
}

export function AchievementsPage() {
  const { data, error, retry } = useLoad(() => api.achievements());
  const items: AchievementProgress[] | null = data?.achievements ?? null;
  const [filter, setFilter] = useState<Filter>('all');

  if (!items && error) return <LoadError title="Постиженията не се заредиха" error={error} onRetry={retry} />;
  if (!items) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const unlocked = items.filter((i) => i.unlockedAt).length;
  const list = ACHIEVEMENTS.filter((a) => {
    const done = !!byId.get(a.id)?.unlockedAt;
    return filter === 'all' || (filter === 'unlocked' ? done : !done);
  }).sort((a, b) => Number(!!byId.get(b.id)?.unlockedAt) - Number(!!byId.get(a.id)?.unlockedAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Постижения</h1>
          <p className="mt-1 text-fg-2">
            Отключени <b className="text-fg">{unlocked}</b> от {ACHIEVEMENTS.length}
          </p>
          <ProgressBar value={unlocked / ACHIEVEMENTS.length} className="mt-3 w-64" gradient="linear-gradient(90deg,#fbbf24,#f472b6)" />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Всички' },
            { value: 'unlocked', label: 'Отключени' },
            { value: 'locked', label: 'Заключени' },
          ]}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((a, i) => {
          const p = byId.get(a.id);
          const done = !!p?.unlockedAt;
          const rarity = RARITIES[a.rarity];
          const extras = rewardsFor(a.id);
          return (
            <motion.div
              key={a.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.4) }}
            >
              <Card
                className={clsx('relative h-full overflow-hidden p-5', !done && 'opacity-75')}
                style={done ? { borderColor: `${rarity.color}55` } : undefined}
              >
                {done && (
                  <div
                    className="absolute -top-12 -right-12 size-36 rounded-full opacity-30 blur-2xl"
                    style={{ background: rarity.color }}
                  />
                )}
                <div className="relative flex items-start gap-4">
                  <span
                    className={clsx('grid size-14 shrink-0 place-items-center rounded-2xl text-3xl', !done && 'grayscale')}
                    style={{ background: done ? `${rarity.color}22` : 'rgb(255 255 255 / 0.05)' }}
                  >
                    {done ? a.icon : <Lock className="size-5 text-fg-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">{a.name}</h3>
                      <span className="text-xs font-bold" style={{ color: rarity.color }}>
                        {rarity.name}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-fg-2">{a.description}</p>
                    <p className="mt-2 text-xs text-fg-3">
                      +{a.xp} XP{extras.length > 0 && ` · ${extras.join(', ')}`}
                    </p>
                  </div>
                </div>
                <div className="relative mt-4">
                  {done ? (
                    <p className="text-xs font-semibold text-emerald-300">✓ Отключено на {longDate(p!.unlockedAt!)}</p>
                  ) : a.goal !== undefined && p?.progress != null ? (
                    <>
                      <div className="mb-1.5 flex justify-between text-xs text-fg-3 tabular-nums">
                        <span>Прогрес</span>
                        <span>
                          {fmt(p.progress)} / {fmt(a.goal)}
                        </span>
                      </div>
                      <ProgressBar value={p.progress / a.goal} gradient={`linear-gradient(90deg, ${rarity.color}99, ${rarity.color})`} />
                    </>
                  ) : (
                    <p className="text-xs text-fg-3">Изпълни го в мач</p>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
      <p className="text-center text-xs text-fg-3">
        Някои постижения отключват специални аватари, рамки и титли —{' '}
        <Link to="/locker" className="font-semibold text-violet-300 hover:text-violet-200">
          виж Колекция
        </Link>
        .
      </p>
    </div>
  );
}
