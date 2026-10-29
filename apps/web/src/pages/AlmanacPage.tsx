import { api, fmt, plural, useStore } from '@quiz/client';
import { type AlmanacFact, type CATEGORIES, categoryById, isCategoryId } from '@quiz/shared';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { FactItem, ReviewCard, TierBadge } from '../components/almanac';
import { Emoji } from '../components/Emoji';
import { LoadError } from '../components/LoadError';
import { Card, EmptyState, INPUT, PageSpinner, ProgressBar } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';
import { NotFoundPage } from './NotFoundPage';

/** „Моят алманах“ (/almanac), or one of its categories (/almanac/<category>). */
export function AlmanacPage() {
  const { category } = useParams();
  if (category === undefined) return <Overview />;
  return isCategoryId(category) ? <CategoryFacts category={category} /> : <NotFoundPage />;
}

/** Every fact the player has made theirs, by category, with „Поправителен“ for the questions they missed. */
function Overview() {
  usePageTitle('Моят алманах');
  // A match just played may have added some: loaded afresh each time the facts or the queue change.
  const version = useStore((s) => `${s.me?.almanac.facts}:${s.me?.almanac.due}`);
  const { data, error, retry } = useLoad(() => api.almanac(), version);
  if (!data && error) return <LoadError title="Алманахът не се зареди" error={error} onRetry={retry} />;
  if (!data) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="t-eyebrow text-fg-3">Моят алманах</p>
        <h1 className="mt-2 font-display text-4xl font-black sm:text-5xl">
          {fmt(data.facts)} <span className="text-2xl font-bold text-fg-3 sm:text-3xl">от {fmt(data.total)} факта</span>
        </h1>
        <ProgressBar value={data.total ? data.facts / data.total : 0} className="mt-4 max-w-md" />
        <p className="mt-3 max-w-xl text-sm text-fg-2 text-pretty">
          Всеки „Знаеше ли?“ зад въпрос, който познаеш — или на който спреш да прочетеш, когато играеш сам, — остава
          тук.
        </p>
      </header>

      <ReviewCard queue={data.review} />

      <section aria-labelledby="almanac-categories">
        <h2 id="almanac-categories" className="sr-only">
          По категории
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.categories.map((c) => {
            const cat = categoryById(c.category)!;
            return (
              <li key={c.category}>
                <Link
                  to={`/almanac/${c.category}`}
                  className="focus-ring glass flex items-center gap-4 rounded-3xl p-4 transition-colors hover:bg-tint/[0.06]"
                >
                  <span aria-hidden className="text-3xl leading-none">
                    <Emoji e={cat.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">{cat.name}</span>
                      {c.tier !== null && <TierBadge tier={c.tier} />}
                    </span>
                    <span className="mt-1 block text-sm text-fg-3 tabular-nums">
                      {fmt(c.facts)} / {fmt(c.total)}
                    </span>
                    <ProgressBar
                      value={c.total ? c.facts / c.total : 0}
                      className="mt-2 h-1.5"
                      gradient={`linear-gradient(90deg, ${cat.color}aa, ${cat.color})`}
                    />
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {data.recent.length > 0 && (
        <Card className="p-5 sm:p-6">
          <h2 className="t-card">Последно научено</h2>
          <ul className="mt-4 space-y-4">
            {data.recent.map((f) => (
              <li key={f.id}>
                <FactItem fact={f} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const matches = (f: AlmanacFact, words: string[]) => {
  const text = `${f.q} ${f.answer ?? ''} ${f.fact}`.toLocaleLowerCase('bg');
  return words.every((w) => text.includes(w));
};

/** One category's facts, newest first, with a search once there are enough to need one. */
function CategoryFacts({ category }: { category: (typeof CATEGORIES)[number]['id'] }) {
  const cat = categoryById(category)!;
  usePageTitle(`${cat.name} · Моят алманах`);
  const { data, error, retry } = useLoad(() => api.almanacCategory(category), category);
  const [query, setQuery] = useState('');
  const words = useDeferredValue(query).toLocaleLowerCase('bg').split(/\s+/u).filter(Boolean);
  if (!data && error) return <LoadError title="Алманахът не се зареди" error={error} onRetry={retry} />;
  if (!data) return <PageSpinner />;
  const shown = words.length ? data.facts.filter((f) => matches(f, words)) : data.facts;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/almanac"
        className="focus-ring -my-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-fg-3 hover:text-fg-2"
      >
        <ArrowLeft aria-hidden className="size-4" /> Моят алманах
      </Link>
      <header className="flex flex-wrap items-center gap-4">
        <span aria-hidden className="text-5xl leading-none">
          <Emoji e={cat.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="t-page">{cat.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-fg-2">
            {fmt(data.facts.length)} от {plural(data.total, 'факт', 'факта')}
            {data.tier !== null && <TierBadge tier={data.tier} />}
          </p>
        </div>
      </header>
      <ProgressBar
        value={data.total ? data.facts.length / data.total : 0}
        gradient={`linear-gradient(90deg, ${cat.color}aa, ${cat.color})`}
      />

      {data.facts.length === 0 ? (
        <Card>
          <EmptyState
            icon="📖"
            title="Още нищо тук"
            body={`Отговори вярно на въпрос от „${cat.name}“ — фактът зад него ще остане тук.`}
          />
        </Card>
      ) : (
        <>
          {data.facts.length > 8 && (
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-3"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={`Търси във фактите от „${cat.name}“`}
                placeholder="Търси във фактите"
                className={`${INPUT} pl-11`}
              />
            </div>
          )}
          <Card>
            {shown.length ? (
              <ul className="divide-y divide-line">
                {shown.map((f) => (
                  <li key={f.id} className="px-5 py-4 sm:px-6">
                    <FactItem fact={f} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-6 text-sm text-fg-3">Нищо не съвпада с „{query.trim()}“.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
