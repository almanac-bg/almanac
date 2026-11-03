import { api, fmt, plural, useStore } from '@quiz/client';
import { type CATEGORIES, categoryById, isCategoryId, type KnowledgeFact } from '@quiz/shared';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Emoji } from '../components/Emoji';
import { FactItem, ReviewCard, TierBadge } from '../components/knowledge';
import { LoadError } from '../components/LoadError';
import { Card, EmptyState, INPUT, PageSpinner, ProgressBar } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';
import { NotFoundPage } from './NotFoundPage';

/** „Моите знания“ (/knowledge), or one of its categories (/knowledge/<category>). */
export function KnowledgePage() {
  const { category } = useParams();
  if (category === undefined) return <Overview />;
  return isCategoryId(category) ? <CategoryFacts category={category} /> : <NotFoundPage />;
}

/** Every fact the player has made theirs, by category, with „Поправителен“ for the questions they missed. */
function Overview() {
  usePageTitle('Моите знания');
  // A match just played may have added some: loaded afresh each time the facts or the queue change.
  const version = useStore((s) => `${s.me?.knowledge.facts}:${s.me?.knowledge.due}`);
  const { data, error, retry } = useLoad(() => api.knowledge(), version);
  if (!data && error) return <LoadError title="Знанията не се заредиха" error={error} onRetry={retry} />;
  if (!data) return <PageSpinner />;

  return (
    <div className="space-y-6">
      {/* The page's name first and how far along under it, as „Постижения“ has them. */}
      <header>
        <h1 className="t-page">Моите знания</h1>
        <p className="mt-2 text-fg-2">
          <b className="text-fg tabular-nums">{fmt(data.facts)}</b> от {plural(data.total, 'факт', 'факта')}
        </p>
        <ProgressBar value={data.total ? data.facts / data.total : 0} className="mt-3 max-w-md" />
        <p className="mt-3 max-w-xl text-sm text-fg-2 text-pretty">
          Тук остава всеки „Знаеше ли?“ от въпрос, който познаеш, и всеки, който спреш да прочетеш в „Соло“.
        </p>
      </header>

      <ReviewCard queue={data.review} />

      <section aria-labelledby="knowledge-categories">
        <h2 id="knowledge-categories" className="sr-only">
          По категории
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.categories.map((c) => {
            const cat = categoryById(c.category)!;
            return (
              <li key={c.category}>
                <Link
                  to={`/knowledge/${c.category}`}
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

const matches = (f: KnowledgeFact, words: string[]) => {
  const text = `${f.q} ${f.answer ?? ''} ${f.fact}`.toLocaleLowerCase('bg');
  return words.every((w) => text.includes(w));
};

/** One category's facts, newest first, with a search once there are enough to need one. */
function CategoryFacts({ category }: { category: (typeof CATEGORIES)[number]['id'] }) {
  const cat = categoryById(category)!;
  usePageTitle(`${cat.name} · Моите знания`);
  const { data, error, retry } = useLoad(() => api.knowledgeCategory(category), category);
  const [query, setQuery] = useState('');
  const words = useDeferredValue(query).toLocaleLowerCase('bg').split(/\s+/u).filter(Boolean);
  if (!data && error) return <LoadError title="Знанията не се заредиха" error={error} onRetry={retry} />;
  if (!data) return <PageSpinner />;
  const shown = words.length ? data.facts.filter((f) => matches(f, words)) : data.facts;

  return (
    <div className="space-y-6">
      <Link
        to="/knowledge"
        className="focus-ring -my-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-fg-3 hover:text-fg-2"
      >
        <ArrowLeft aria-hidden className="size-4" /> Моите знания
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
            <div className="relative max-w-md">
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
          {/* Two across on a wide screen: the page as wide as the others, the lines still short enough to read. */}
          {shown.length ? (
            <ul className="grid gap-3 lg:grid-cols-2">
              {shown.map((f) => (
                <li key={f.id} className="glass rounded-3xl p-5 sm:p-6">
                  <FactItem fact={f} />
                </li>
              ))}
            </ul>
          ) : (
            <Card className="p-6 text-sm text-fg-3">Нищо не съвпада с „{query.trim()}“.</Card>
          )}
        </>
      )}
    </div>
  );
}
