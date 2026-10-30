import { fmt } from '@quiz/client';
import {
  BRAND,
  CATEGORIES,
  CATEGORY_ABOUT,
  type CategoryId,
  categoryById,
  EVENING,
  IMAGE,
  MODES,
  NUMBER,
  ORDER,
  POWERUPS,
  QUEUE_MODES,
  RANK_TIERS,
  READING,
  REVIEW,
  ROOM_CODE_DIGITS,
  ROOM_LIMITS,
  ROUNDS,
  SCORING,
  SEASON_MIN_GAMES,
  SETS,
  STREAK_SHIELDS,
} from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, Check, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
// The public sample questions (the same file is in the open-source repository): the real bank never leaves the server.
import SAMPLE from '../../../server/src/data/questions.sample.json';
import { Emoji } from '../components/Emoji';
import { LETTERS } from '../components/game/answers';
import { LegalLinks } from '../components/LegalLinks';
import { Logo } from '../components/NavBar';
import { buttonClass, Card } from '../components/ui';
import CHRISTMAS from '../content/christmas.json';
import { useSite } from '../lib/site';
import { usePublicPageTitle } from '../lib/title';
import { keepTogether } from '../lib/typography';
import { NotFoundPage } from './NotFoundPage';

interface SampleQuestion {
  id: string;
  category: CategoryId;
  kind?: string;
  q: string;
  options?: string[];
  answer?: number;
  fact?: string;
  factSource?: string;
  image?: unknown;
}

/** The sample's plain four-option questions (pictures need the game's own files; numbers and orders its screens). */
const CHOICE = (SAMPLE as SampleQuestion[]).filter(
  (q): q is SampleQuestion & { options: string[]; answer: number } =>
    (q.kind ?? 'choice') === 'choice' && !q.image && !!q.options && q.answer !== undefined,
);
const byCategory = (id: CategoryId) => CHOICE.filter((q) => q.category === id);

type QuizQuestion = { id: string; q: string; options: string[]; answer: number; fact?: string; factSource?: string };

/** Quizzes for a holiday, from a pool of their own (never in the game's bank): their own page each. */
const HOLIDAYS: Record<string, { name: string; icon: string; lead: string; questions: QuizQuestion[] }> = {
  christmas: {
    name: 'Коледна викторина',
    icon: '🌟',
    lead: 'Бъдни вечер, коледари и „Тиха нощ“ — коледни въпроси с отговори.',
    questions: CHRISTMAS as QuizQuestion[],
  },
};

const seconds = (ms: number) => `${(ms / 1000).toLocaleString('bg-BG')} с`;

/** The guides' frame: the name home, the guides' own links, the page, a way into the game, the legal links. */
/** What a guide page leads on to: the day's questions, unless the page has a better next step of its own. */
interface GuideCta {
  to: string;
  label: string;
  note?: string;
}
const DAILY_CTA: GuideCta = {
  to: '/daily',
  label: 'Играй въпросите на деня',
  note: 'Безплатно, без регистрация и без реклами.',
};

function GuideLayout({
  title,
  lead,
  cta = DAILY_CTA,
  children,
}: {
  title: string;
  lead: ReactNode;
  cta?: GuideCta;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Link to="/" className="text-2xl">
          <Logo />
        </Link>
        {/* Each link a full 44 px tall (the project's target size), not the 20 px of its line. */}
        <nav
          aria-label="Ръководства"
          className="flex flex-wrap gap-x-4 text-sm font-semibold text-fg-2 [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center"
        >
          <Link to="/how-to-play" className="hover:text-fg">
            Как се играе
          </Link>
          <Link to="/quiz" className="hover:text-fg">
            Викторини
          </Link>
          <Link to="/facts" className="hover:text-fg">
            Факти
          </Link>
          <Link to="/teachers" className="hover:text-fg">
            За учители
          </Link>
        </nav>
      </div>
      <Card className="mt-6 bg-ink-2/70 p-6 sm:p-10">
        <h1 className="t-page">{title}</h1>
        <div className="mt-3 text-[15px] leading-relaxed text-fg-2">{lead}</div>
        <div className="mt-8 space-y-10 text-[15px] leading-relaxed text-fg-2 [&_b]:text-fg">{children}</div>
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <Link to={cta.to} className={buttonClass({ variant: 'gold', size: 'lg' })}>
            {cta.label} <ArrowRight aria-hidden className="size-5" />
          </Link>
          {cta.note && <span className="text-sm text-fg-3">{cta.note}</span>}
        </div>
      </Card>
      <LegalLinks className="mt-6 justify-center" />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 t-card text-fg">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ─── /how-to-play ────────────────────────────────────────────────────────────

/** The rules as the game plays them: every number below is the game's own constant. */
export function HowToPlayPage() {
  usePublicPageTitle(useLocation().pathname);
  const ranked = QUEUE_MODES.map((id) => MODES[id]);
  return (
    <GuideLayout
      title="Как се играе"
      lead={
        <>
          {BRAND.name} е онлайн викторина на български: повечето въпроси са с четири отговора, а има и такива с число и
          за подреждане. Верният отговор носи точки, а бързият — още повече.
        </>
      }
    >
      <Section title="Въпросите на деня">
        <p>
          Всеки ден — <b>{MODES.daily.questions}&nbsp;въпроса, едни и същи за цяла България</b>, и една класация до
          полунощ. Имаш един опит. Играеш ли всеки ден, трупаш серия; на всеки {STREAK_SHIELDS.every}&nbsp;дни получаваш
          щит (до {STREAK_SHIELDS.max}), който пази серията, ако пропуснеш ден.
        </p>
      </Section>

      <Section title="Как се смятат точките">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Верен отговор: <b>{SCORING.base}&nbsp;точки</b>.
          </li>
          <li>
            Бонус за бързина: до <b>{SCORING.speed}&nbsp;точки</b>. Започва да намалява едва след като въпросът е
            прочетен (от {seconds(READING.minMs)} до {seconds(READING.maxMs)} според дължината му), така че по-бързото
            четене не носи предимство.
          </li>
          <li>
            Серия от верни отговори: +{SCORING.streakStep} за всеки следващ, до +{SCORING.streakMax}.
          </li>
        </ul>
      </Section>

      <Section title="Козовете">
        <p>
          Всеки коз се играе веднъж на мач — и най-много един на въпрос. Във въпросите на деня и в линковете всички
          играят без тях.
        </p>
        <ul className="space-y-2">
          {POWERUPS.map((p) => (
            <li key={p.id} className="flex gap-3">
              <Emoji e={p.icon} className="mt-0.5 size-5 shrink-0" size="" />
              <span>
                <b>{p.name}</b> — {p.description}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Режимите">
        <ul className="space-y-3">
          {[MODES.solo, ...ranked, MODES.challenge].map((m) => (
            <li key={m.id}>
              <b>{m.name}</b> — {m.description}
            </li>
          ))}
          <li>
            <b>{MODES.evening.name}</b> — всяка вечер в {EVENING.hour}:00, до&nbsp;{EVENING.maxPlayers}&nbsp;души;
            входът се отваря {EVENING.lobbyMinutes}&nbsp;минути преди това. Победителят на мач с поне{' '}
            {EVENING.titleFrom}&nbsp;души носи титлата „Шампион на вечерта“. Отпадналият може да отговаря до края — за
            XP и алманаха, извън класирането.
          </li>
        </ul>
      </Section>

      <Section title="Рундове и финал с число">
        <p>
          Дуел и Арена се играят в {ROUNDS.count}&nbsp;рунда по&nbsp;{ROUNDS.size}&nbsp;въпроса. Преди всеки следващ
          рунд изоставащият има {seconds(ROUNDS.pickMs)} да избере категорията от&nbsp;
          {ROUNDS.offer === 3 ? 'три' : ROUNDS.offer}. Последният въпрос е <b>финал с число</b>: пишеш година, височина
          или брой, а точките зависят от това колко близо си — до&nbsp;{NUMBER.points}, плюс {NUMBER.exactBonus} за
          точния отговор. Финалът се брои ×{NUMBER.finalTimes}, така че може да обърне мача.
        </p>
      </Section>

      <Section title="Картини и „Подреди“">
        <p>
          Някои въпроси са за картина — за тях имаш {seconds(IMAGE.timeMs)}. В „Подреди“ нареждаш четири неща по реда
          им: всяко на място носи {ORDER.perItem}&nbsp;точки, а всички на място — и бонус за бързина.
        </p>
      </Section>

      <Section title="Нива, рангове и сезони">
        <p>
          Всеки мач носи опит (XP): качваш нива и отключваш аватари, рамки и титли. Класираните мачове местят рейтинга
          ти, а с него и ранга: {RANK_TIERS.map((t) => t.name).join(', ')}. Сезонът е един месец; в края му идва награда
          според най-високия ранг в режим, в който имаш поне {SEASON_MIN_GAMES} мача.
        </p>
      </Section>

      <Section title="Гост и профил">
        <p>
          Можеш да играеш веднага, като гост: прогресът се пази на това устройство. С име и парола (профил) той е твой
          на всяко устройство, а с него идват приятелите, класациите и групите. Нов профил влиза в класацията на
          въпросите на деня от следващия ден — иначе втори профил, направен за секунди, би бил класиран до основния.
        </p>
      </Section>

      <Section title="Стаи, класове и свои въпроси">
        <p>
          Частна стая се прави с профил: каниш с код от {ROOM_CODE_DIGITS} цифри или линк, до&nbsp;
          {ROOM_LIMITS.maxPlayers[1]}&nbsp;души, с твоите настройки. С „Само водя“ мачът върви на голям екран, а
          играчите отговарят от телефоните си — за час в клас или за парти. В „Моите въпроси“ пишеш свои набори
          (до&nbsp;
          {SETS.maxQuestions}&nbsp;въпроса) и ги играете в стаята. Повече — в{' '}
          <Link to="/teachers" className="text-violet-300 underline">
            {BRAND.name} в час
          </Link>
          .
        </p>
      </Section>

      <Section title="Моят алманах, „Поправителен“ и групи">
        <p>
          Всеки „Знаеше ли?“ от въпрос, който познаеш, остава в „Моят алманах“. Сгрешените въпроси се връщат в
          „Поправителен“ след {REVIEW.afterDays.join(', ').replace(/, (\d+)$/, ' и $1')} дни, докато ги запомниш. Група
          (клас, офис, семейство) има линк за покана и седмична класация на въпросите на деня. Примерни въпроси по
          категории има във{' '}
          <Link to="/quiz" className="text-violet-300 underline">
            викторините
          </Link>
          .
        </p>
      </Section>
    </GuideLayout>
  );
}

// ─── /quiz ───────────────────────────────────────────────────────────────────

export function QuizHubPage() {
  usePublicPageTitle(useLocation().pathname);
  const total = useSite()?.questions;
  return (
    <GuideLayout
      title="Викторини по категории"
      lead={
        <>
          Опитай въпроси от всяка категория — с верния отговор и факт „Знаеше ли?“ към тях. В играта те чакат
          {total ? ` над ${fmt(total)}` : ' още много'}&nbsp;въпроса, с часовник и класация.
        </>
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {CATEGORIES.map((c) => (
          <li key={c.id}>
            <Link
              to={`/quiz/${c.id}`}
              className="focus-ring flex items-center gap-3 rounded-2xl border border-line bg-tint/[0.03] p-4 transition-colors hover:bg-tint/[0.07]"
            >
              <Emoji e={c.icon} className="size-8 shrink-0" size="" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-fg">{c.name}</span>
                <span className="text-sm text-fg-3">{byCategory(c.id).length}&nbsp;въпроса с отговори</span>
              </span>
              <ArrowRight aria-hidden className="size-4 text-fg-3" />
            </Link>
          </li>
        ))}
      </ul>
      <Section title="Празнични">
        <ul className="grid gap-3 sm:grid-cols-2">
          {Object.entries(HOLIDAYS).map(([slug, h]) => (
            <li key={slug}>
              <Link
                to={`/quiz/${slug}`}
                className="focus-ring flex items-center gap-3 rounded-2xl border border-line bg-tint/[0.03] p-4 transition-colors hover:bg-tint/[0.07]"
              >
                <Emoji e={h.icon} className="size-8 shrink-0" size="" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-fg">{h.name}</span>
                  <span className="text-sm text-fg-3">{h.questions.length}&nbsp;въпроса с отговори</span>
                </span>
                <ArrowRight aria-hidden className="size-4 text-fg-3" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </GuideLayout>
  );
}

/** One category's sample questions: tap an answer to see whether it's right (or open the answer without guessing). */
export function QuizCategoryPage() {
  const { category } = useParams();
  const holiday = HOLIDAYS[category ?? ''];
  const found = categoryById(category ?? '');
  const c = found && found.id !== 'mixed' ? found : null;
  const title = holiday ? holiday.name : c ? `Викторина: ${c.name}` : undefined;
  usePublicPageTitle(useLocation().pathname);
  const [picked, setPicked] = useState<Record<string, number>>({});
  if (!holiday && !c) return <NotFoundPage standalone />;
  const questions: QuizQuestion[] = holiday ? holiday.questions : byCategory(c!.id);
  const answered = questions.filter((q) => picked[q.id] !== undefined);
  const right = answered.filter((q) => picked[q.id] === q.answer).length;
  return (
    <GuideLayout
      title={title!}
      lead={
        <>
          {holiday
            ? holiday.lead
            : keepTogether(`„${c!.name}“: ${CATEGORY_ABOUT[c!.id]}. ${questions.length} въпроса с отговори.`)}{' '}
          Натисни отговор, за да видиш дали е верен — или отвори отговора направо.
        </>
      }
    >
      <ol className="space-y-6">
        {questions.map((q, i) => {
          const choice = picked[q.id];
          const done = choice !== undefined;
          return (
            <li key={q.id} className="rounded-2xl border border-line bg-tint/[0.02] p-4 sm:p-5">
              <h2 className="font-semibold text-fg">
                <span className="text-fg-3">{i + 1}.</span> {keepTogether(q.q)}
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {q.options.map((o, k) => {
                  const isRight = k === q.answer;
                  return (
                    <li key={o}>
                      <button
                        type="button"
                        // Answered: no second pick, but still focusable (disabled, the focus fell to the page).
                        aria-disabled={done || undefined}
                        onClick={() => !done && setPicked((p) => ({ ...p, [q.id]: k }))}
                        className={clsx(
                          'focus-ring flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                          !done && 'border-line hover:bg-tint/[0.07]',
                          done && isRight && 'border-emerald-400/60 bg-emerald-500/15 font-semibold text-fg',
                          done && !isRight && choice === k && 'border-rose-400/60 bg-rose-500/10 line-through',
                          done && !isRight && choice !== k && 'border-line opacity-60',
                        )}
                      >
                        <span className="font-display font-bold text-fg-3">{LETTERS[k]}</span>
                        <span className="min-w-0 flex-1">{keepTogether(o)}</span>
                        {done && isRight && <Check aria-label="верен" className="size-4 text-emerald-300" />}
                        {done && !isRight && choice === k && <X aria-label="грешен" className="size-4 text-rose-300" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* Without guessing (and without scripts: a search engine, a slow phone) the answer is a tap away. */}
              <details open={done || undefined} className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-violet-300">Отговор</summary>
                <p className="mt-2">
                  Верен отговор: <b>{keepTogether(q.options[q.answer])}</b>.
                  {q.fact && (
                    <>
                      {' '}
                      <span className="font-semibold text-amber-200">Знаеше ли?</span> {keepTogether(q.fact)}
                      {q.factSource && (
                        <>
                          {' '}
                          <a
                            href={q.factSource}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-violet-300 underline"
                          >
                            източник
                          </a>
                        </>
                      )}
                    </>
                  )}
                </p>
              </details>
            </li>
          );
        })}
      </ol>
      {/* Always there, empty until a first answer: a live region that comes in already holding its text isn't read. */}
      <p
        role="status"
        className={answered.length ? 'rounded-2xl bg-violet-500/10 px-4 py-3 font-semibold text-fg' : 'sr-only'}
      >
        {answered.length > 0 && (
          <>
            Позна {right} от {answered.length}.{' '}
            {answered.length === questions.length && 'В играта — с часовник, козове и класация.'}
          </>
        )}
      </p>
      <nav aria-label="Други категории" className="flex flex-wrap gap-2">
        {CATEGORIES.filter((x) => x.id !== c?.id).map((x) => (
          <Link
            key={x.id}
            to={`/quiz/${x.id}`}
            className="rounded-full border border-line bg-tint/5 px-3 py-1.5 text-sm text-fg-2 hover:text-fg"
          >
            <Emoji e={x.icon} /> {x.name}
          </Link>
        ))}
      </nav>
    </GuideLayout>
  );
}

// ─── /facts ──────────────────────────────────────────────────────────────────

export function FactsPage() {
  usePublicPageTitle(useLocation().pathname);
  return (
    <GuideLayout
      title="Знаеше ли?"
      lead={
        <>
          След всеки отговор в {BRAND.name} идва факт за него — нещо вярно и изненадващо, с източник. Ето някои от тях;
          всички, които научиш в играта, се събират в „Моят алманах“.
        </>
      }
    >
      {CATEGORIES.map((c) => {
        const facts = byCategory(c.id).filter((q) => q.fact);
        if (!facts.length) return null;
        return (
          <Section key={c.id} title={`${c.name}`}>
            <ul className="space-y-3">
              {/* The question first: a fact is written to follow it, and alone it often says nothing („Оранжев.“ —
                  of what?). */}
              {facts.map((q) => (
                <li key={q.id}>
                  <b>{keepTogether(q.q)}</b> {keepTogether(q.options[q.answer])}. {keepTogether(q.fact ?? '')}{' '}
                  {q.factSource && (
                    <a
                      href={q.factSource}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-violet-300 underline"
                    >
                      източник
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </GuideLayout>
  );
}

// ─── /teachers ───────────────────────────────────────────────────────────────

export function TeachersPage() {
  usePublicPageTitle(useLocation().pathname);
  return (
    <GuideLayout
      title={`${BRAND.name} в час`}
      // A teacher came to run a class, not to play the day's questions: the room is a profile away.
      cta={{ to: '/', label: 'Създай стая за класа', note: 'С безплатен профил — после „Създай стая“ и „Само водя“.' }}
      lead={
        <>
          Викторина за цял клас: учениците влизат с код от телефоните си, а въпросите и класирането са на голям екран.
          Безплатно и без реклами.
        </>
      }
    >
      <Section title="Стая за класа">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            До <b>{ROOM_LIMITS.maxPlayers[1]}&nbsp;души</b> в една стая; учениците влизат с код от&nbsp;
            {ROOM_CODE_DIGITS} цифри или с линк.
          </li>
          <li>
            <b>Без регистрация за учениците:</b> влизат като гости и си избират име за стаята. Профил е нужен само на
            учителя.
          </li>
          <li>
            <b>Заключете стаята,</b> щом класът е вътре: който влезе с кода след това, чака на вратата, а вие решавате
            дали да влезе. Име, което не е за проектора, сменяте с „Играч“ и номер.
          </li>
          <li>
            <b>„Само водя“:</b> учителят не играе, а показва на проектора въпроса, как е отговорил класът и класирането.
            На всеки отговор „Пауза“ задържа следващия въпрос, докато го обсъдите, а „Следващ въпрос“ го пуска веднага —
            и от презентационно дистанционно (стрелка надясно).
          </li>
          <li>Вие избирате категориите, броя въпроси ({ROOM_LIMITS.questions.join(', ')}) и времето за въпрос.</li>
        </ul>
      </Section>

      <Section title="Вашите въпроси">
        <p>
          В „Моите въпроси“ правите свои набори — до&nbsp;{SETS.maxQuestions}&nbsp;въпроса в набор, с картини и въпроси
          „Подреди“ — и ги играете в стаята си. Можете да споделите набор с колега чрез линк.
        </p>
      </Section>

      <Section title="Данните на учениците">
        <p>
          Учениците влизат като гости — без имейл и парола. Името за стаята си избират сами: по-добре само първо име или
          прякор. Гост, влязъл с линка или кода на стаята, се изтрива до час, след като ученикът излезе, заедно с
          отговорите му; в историята на стаята остава „Изтрит играч“. Името не остава и на устройството — важно, когато
          класът ползва общи таблети.
        </p>
        <p>
          Ако учениците са под 14 години, за участието им е нужно съгласие на родител или настойник — обикновено то е
          част от съгласията, които училището събира за дигитални занимания. Подробности — в{' '}
          <Link to="/privacy" className="text-violet-300 underline">
            Политиката за поверителност
          </Link>
          .
        </p>
      </Section>
    </GuideLayout>
  );
}
