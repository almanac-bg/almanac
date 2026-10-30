import { categoryById } from '@quiz/shared';
import clsx from 'clsx';
import { Check, Lightbulb, X } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { keepTogether } from '../../lib/typography';
import { Emoji } from '../Emoji';
import { accentText, LETTERS, OPTION_COLORS } from '../game/answers';

/** The public sample bank's mus-016, as the game asks it. */
const SAMPLE = {
  category: 'music',
  q: 'Коя народна песен в изпълнение на Валя Балканска е изпратена в Космоса с „Вояджър“?',
  options: ['„Излел е Дельо хайдутин“', '„Полегнала е Тодора“', '„Бела съм, бела, юначе“', '„Хубава си, моя горо“'],
  answer: 0,
  fact: 'Златната плоча носи 27 музикални записа от целия свят. Копие има на всяка от двете сонди „Вояджър“, а те вече са в междузвездното пространство.',
};

/**
 * „Опитай“ on the landing: the game shown rather than described. One question with its four answers; a tap shows the
 * right one and its „Знаеше ли?“, then the way to the day's ten. No clock and nothing sent: a taste, not a match.
 */
export function SampleQuestion({ cta }: { cta: ReactNode }) {
  const [picked, setPicked] = useState<number | null>(null);
  const id = useId();
  const cat = categoryById(SAMPLE.category)!;
  const revealed = picked !== null;

  return (
    <section aria-labelledby={id} className="glass mt-8 rounded-3xl p-5 sm:p-8">
      <p className="t-eyebrow text-violet-300">Опитай с един въпрос</p>
      <p className="mt-3 text-sm font-semibold" style={{ color: accentText(cat.color) }}>
        <Emoji e={cat.icon} /> {cat.name}
      </p>
      <h3 id={id} className="mt-1.5 text-xl leading-snug font-bold text-balance sm:text-2xl">
        {keepTogether(SAMPLE.q)}
      </h3>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {SAMPLE.options.map((text, i) => {
          const state = !revealed ? 'idle' : i === SAMPLE.answer ? 'correct' : i === picked ? 'wrong' : 'dim';
          const color = OPTION_COLORS[i];
          return (
            <button
              key={text}
              type="button"
              // Not `disabled`: the answer just picked keeps the focus.
              aria-disabled={revealed || undefined}
              onClick={() => !revealed && setPicked(i)}
              className={clsx(
                'focus-ring flex min-h-14 items-center gap-3 rounded-2xl border px-3.5 py-3 text-left font-semibold transition-colors',
                state === 'correct'
                  ? 'border-emerald-300 bg-emerald-400 text-on-fill'
                  : state === 'wrong'
                    ? 'border-2 border-rose-400'
                    : 'border-line bg-tint/[0.045]',
                state === 'idle' && 'hover:bg-tint/[0.08]',
                state === 'dim' && 'opacity-45',
              )}
            >
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-xl font-display text-sm font-bold"
                style={{
                  background:
                    state === 'correct'
                      ? 'color-mix(in oklab, currentColor 16%, transparent)'
                      : state === 'wrong'
                        ? '#fb7185'
                        : `${color}22`,
                  color: state === 'correct' ? 'inherit' : state === 'wrong' ? '#0b0a14' : accentText(color),
                }}
              >
                {state === 'correct' ? (
                  <Check className="size-5" />
                ) : state === 'wrong' ? (
                  <X className="size-5" />
                ) : (
                  LETTERS[i]
                )}
              </span>
              <span className="sr-only">{LETTERS[i]}) </span>
              <span className={clsx(state === 'wrong' && 'line-through')}>{text}</span>
              {state === 'correct' && (
                <span className="sr-only"> — верен отговор{picked === i && ', твоят избор'}</span>
              )}
              {state === 'wrong' && <span className="sr-only"> — твоят избор, грешен</span>}
            </button>
          );
        })}
      </div>
      <div aria-live="polite">
        {revealed && (
          <div className="mt-5">
            <p
              className={clsx(
                'font-display text-2xl font-bold',
                picked === SAMPLE.answer ? 'text-emerald-300' : 'text-rose-300',
              )}
            >
              {picked === SAMPLE.answer ? (
                <>
                  Вярно! <Emoji e="🎉" />
                </>
              ) : (
                <>
                  Не позна <Emoji e="😬" />
                </>
              )}
            </p>
            <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4">
              <p className="inline-flex items-center gap-1.5 t-eyebrow text-amber-300">
                <Lightbulb aria-hidden className="size-4" /> Знаеше ли?
              </p>
              <p className="mt-1.5 text-fg-2">{keepTogether(SAMPLE.fact)}</p>
            </div>
            <p className="mt-4 text-sm text-fg-2">
              Такъв е всеки въпрос: отговаряш срещу часовника, после научаваш нещо за отговора. Днешните десет са едни и
              същи за цяла България.
            </p>
            {cta && <div className="mt-4 max-w-sm">{cta}</div>}
          </div>
        )}
      </div>
    </section>
  );
}
