import { fmt } from '@quiz/client';
import { BRAND, CATEGORIES, isQueueMode, MODES, type ModeId, RANK_TIERS } from '@quiz/shared';
import clsx from 'clsx';
import { type ReactNode, useId } from 'react';
import { Link } from 'react-router';
import { useSite } from '../../lib/site';
import { Emoji } from '../Emoji';
import { LegalLinks } from '../LegalLinks';
import { SampleQuestion } from './SampleQuestion';

const ABOUT_MODES: ModeId[] = ['daily', 'challenge', 'duel', 'royale', 'solo', 'custom'];

const WHY: { icon: string; title: string; text: string }[] = [
  {
    icon: '✅',
    title: 'Проверени въпроси',
    text: 'Всеки въпрос е проверен по източник. Видиш ли грешка, сигнализираш от прегледа след мача — и я поправяме.',
  },
  {
    icon: '💡',
    title: 'Научаваш по нещо всеки ден',
    text: 'След отговора — „Знаеше ли?“ с факт за него. Всичко научено се събира в „Моят алманах“.',
  },
  {
    icon: '🫂',
    title: 'С приятели и с цяла България',
    text: 'Една класация за въпросите на деня, дуели по линк, групи със седмична класация и Роял всяка вечер.',
  },
  {
    icon: '🛡️',
    title: 'Без реклами и проследяване',
    text: 'Безплатно, без реклами и без проследяващи бисквитки. Кодът на играта е отворен.',
  },
];

/** „Защо АЛМАНАХ“: what sets it apart, in four lines, after how it's played. */
export function WhyAlmanac() {
  const id = useId();
  return (
    <div className="mt-12">
      {/* One string: the drawn page holds it whole (no marker between the parts). */}
      <p className="t-eyebrow text-violet-300">{`Защо ${BRAND.name}`}</p>
      <h2 id={id} className="mt-2 t-section text-balance">
        Игра, след която знаеш повече
      </h2>
      <ul aria-labelledby={id} className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {WHY.map((w) => (
          <li key={w.title} className="glass rounded-2xl p-5">
            <Emoji e={w.icon} className="size-8" size="" />
            <h3 className="mt-3 t-card">{w.title}</h3>
            <p className="mt-1.5 text-sm text-fg-3">{w.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The game in numbers, under the slogan: how many questions, and what it costs (nothing). */
export function ProofLine({ className }: { className?: string }) {
  const questions = useSite()?.questions;
  // One string: the drawn page holds the sentence whole (no markers between its parts).
  const line = `${questions ? `Над ${fmt(questions)} въпроса, проверени по източници` : 'Въпроси, проверени по източници'} · ${CATEGORIES.length} категории · безплатно · без реклами`;
  return <p className={clsx('text-sm text-fg-3', className)}>{line}</p>;
}

/**
 * Below the first screen: the game in words, for a newcomer who scrolls before trying and for search engines (the
 * first screen alone is a logo, a slogan and a form).
 */
export function AboutGame({ cta }: { cta: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mx-auto max-w-6xl px-4 pt-10 pb-6 sm:px-5 sm:pt-16">
      <p className="t-eyebrow text-violet-300">Как се играе</p>
      <h2 id={id} className="mt-2 t-section text-balance sm:text-3xl">
        Онлайн викторина с приятели и цяла България
      </h2>
      <p className="mt-3 max-w-2xl text-fg-2 sm:text-lg">
        Отговаряш срещу часовника — с избор от четири, с число или като подреждаш: верният отговор носи точки, а бързият
        — още повече. Играеш в браузъра, на телефона или на компютъра. Без изтегляне, без реклами, безплатно.
      </p>

      <SampleQuestion cta={cta} />

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ABOUT_MODES.map((modeId) => {
          const m = MODES[modeId];
          return (
            <li key={modeId} className="glass rounded-2xl p-5">
              <div
                aria-hidden
                className="h-1 w-10 rounded-full"
                style={{ background: `linear-gradient(90deg, ${m.accent[0]}, ${m.accent[1]})` }}
              />
              <h3 className="mt-4 flex flex-wrap items-baseline gap-x-2 t-card">
                {m.name} {isQueueMode(modeId) && <span className="t-eyebrow text-fg-3">{m.short}</span>}
              </h3>
              <p className="mt-1.5 text-sm font-semibold text-fg">{m.tagline}</p>
              <p className="mt-1 text-sm text-fg-3">{m.description}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-10 grid gap-x-16 gap-y-10 lg:grid-cols-2">
        <div>
          <h3 className="t-card">{CATEGORIES.length} категории въпроси</h3>
          <p className="mt-1.5 text-sm text-fg-3">Избираш категория в „Соло“ или играеш микс от всички.</p>
          {/* Each to its guide (/quiz/…): what it asks about, with sample questions. */}
          <ul className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/quiz/${c.id}`}
                  className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-tint/5 px-3 text-sm text-fg-2 hover:bg-tint/10 hover:text-fg"
                >
                  <Emoji e={c.icon} /> {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="t-card">Нива, ранг и колекция</h3>
          <p className="mt-1.5 text-sm text-fg-2">
            Всеки мач носи XP: качваш нива, пазиш серията си с въпросите на деня и отключваш аватари, рамки и титли.
            Класираните мачове местят рейтинга ти, а с него и ранга — от {RANK_TIERS[0].name} до{' '}
            {RANK_TIERS.at(-1)?.name}.
          </p>
          {cta && <div className="mt-6 max-w-sm">{cta}</div>}
        </div>
      </div>

      <WhyAlmanac />

      {/* The guides: for a newcomer who wants the rules first, and for search engines (pages of their own). */}
      <nav
        aria-label="Ръководства"
        className="mt-12 flex flex-wrap justify-center gap-x-5 gap-y-1 border-t border-line pt-4 text-sm font-semibold text-fg-2"
      >
        <Link to="/how-to-play" className="inline-flex min-h-11 items-center hover:text-fg">
          Как се играе
        </Link>
        <Link to="/quiz" className="inline-flex min-h-11 items-center hover:text-fg">
          Викторини по категории
        </Link>
        <Link to="/facts" className="inline-flex min-h-11 items-center hover:text-fg">
          Знаеше ли?
        </Link>
        <Link to="/teachers" className="inline-flex min-h-11 items-center hover:text-fg">
          За учители
        </Link>
      </nav>
      <LegalLinks className="justify-center" />
    </section>
  );
}
