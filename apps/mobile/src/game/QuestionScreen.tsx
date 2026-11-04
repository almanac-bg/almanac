import { DIFFICULTY_LABEL, inDropZone, keepTogether, LETTERS, type LiveGame, nextElimination } from '@almanac/client';
import { categoryById } from '@almanac/shared';
import { type ComponentRef, useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, type Text, View } from 'react-native';
import { Picture } from '@/components/Picture';
import { streak } from '@/lib/sounds';
import { radius, useColors } from '@/theme';
import { IconText, T } from '@/ui';
import { FactNote, PauseAfterAnswer, UntimedEnding } from './Hold';
import { NumberAnswer, NumberReveal, NumberSummary } from './NumberAnswer';
import { OrderAnswer, OrderReveal, OrderSummary } from './OrderAnswer';
import { ActivePowerups, PowerupBar } from './Powerups';
import { AnswerTile, Chip, CrowdNote, LockStatus, RevealSummary, TimerRing } from './parts';

/** The streaks of right answers that sound: a run at each (as the web plays them, Moments.tsx). */
const STREAK_MILESTONES = new Set([3, 5, 7, 10, 15, 20]);

/** A question on screen: the clock, the answers, your pick and how it went (the web's QuestionView). */
export function QuestionScreen({ game, offline }: { game: LiveGame; offline: boolean }) {
  const colors = useColors();
  const q = game.question!;
  const reveal = game.reveal?.index === q.index ? game.reveal : null;
  const youId = game.start.youId;
  const mine = reveal?.results[youId];
  // A streak of right answers at its milestones: a rising run, once the reveal is in.
  const milestone = mine?.correct && STREAK_MILESTONES.has(mine.streak) ? mine.streak : null;
  useEffect(() => {
    if (!milestone) return;
    const later = setTimeout(() => streak(milestone), 380);
    return () => clearTimeout(later);
  }, [milestone]);
  const active = !reveal && !game.resyncing;
  const inert = !active || offline;
  const alone = game.start.players.length === 1;
  // A run alone without a clock (Соло's „Без часовник“, „Повече време“): every answer waits for „Продължи“.
  const untimedRun = game.start.pace === 'untimed' && !game.start.roomCode;
  const cat = categoryById(q.category);
  // Knocked out: the questions go on, and can still be answered — for XP and „Моите знания“, outside the race.
  const out = game.eliminated.includes(youId);

  // Each new question takes the screen reader's focus: read whole — which one, a picture's description, the question,
  // then the options — rather than in a live message the focus move would cut off.
  const heading = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    const node = heading.current && findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  const options =
    q.kind === 'number'
      ? `Напиши число между ${q.number!.min} и ${q.number!.max}.`
      : q.kind === 'order'
        ? `Подреди: ${q.order!.items.map((o, i) => `${LETTERS[i]}) ${o}.`).join(' ')}`
        : q.options.map((o, i) => `${LETTERS[i]}) ${o}.`).join(' ');

  return (
    <View style={{ flex: 1, gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {q.final && <Chip text={`🎯 Финал${q.times > 1 ? ` · ×${q.times}` : ''}`} tone="gold" />}
        {game.start.questionSet ? (
          <Chip text={`📝 ${game.start.questionSet}`} />
        ) : (
          <>
            {cat && <Chip icon={cat.icon} text={cat.name} />}
            <Chip text={DIFFICULTY_LABEL[q.difficulty]} />
          </>
        )}
        {q.elimination && <Chip text="💀 Отпадане след този въпрос" tone="bad" />}
        {out && (
          <Chip text={`💀 Отпадна · ${game.closesAt && !reveal ? 'другите вече отговориха' : 'отговаряш за XP'}`} />
        )}
        {inDropZone(game).has(youId) && !reveal && (
          <Chip
            tone="bad"
            text={
              game.start.mode === 'evening'
                ? q.elimination
                  ? 'Ти си сред отпадащите: изпревари някого!'
                  : `Ти си сред отпадащите · отпадане след въпрос ${nextElimination(game)}`
                : q.elimination
                  ? 'На последно място си: изпревари някого!'
                  : `На последно място си · отпадане след въпрос ${nextElimination(game)}`
            }
          />
        )}
      </View>

      <View
        style={{
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.glass,
          padding: 18,
          gap: 14,
        }}
      >
        {q.image && <Picture image={q.image} credit={reveal?.credit} />}
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
          <T
            ref={heading}
            variant="title"
            role="heading"
            accessibilityLabel={`Въпрос ${q.index + 1} от ${q.total}: ${q.image ? `Картина: ${q.image.alt}. ` : ''}${q.q} ${options}`}
            style={{ flex: 1, fontSize: 20, lineHeight: 28 }}
          >
            {keepTogether(q.q)}
          </T>
          <TimerRing
            deadline={game.closesAt ?? game.deadline}
            duration={q.durationMs}
            stopped={!!reveal || game.paused === q.index}
            untimed={q.speedMs === null}
          />
        </View>
        {q.author ? (
          <IconText icon="✍️" variant="caption" tone="fg3">
            Въпрос от {q.author}
          </IconText>
        ) : null}
      </View>

      {game.retryPrompt && !reveal && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            padding: 12,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: 'rgba(251,191,36,0.4)',
            backgroundColor: 'rgba(251,191,36,0.1)',
          }}
        >
          <T variant="bodyStrong" tone="gold">
            🔁 Грешно! Имаш още един опит (за ½ точки)
          </T>
        </View>
      )}

      <View style={{ marginTop: 'auto', gap: 10 }}>
        {q.kind === 'number' ? (
          reveal?.answerNumber !== undefined ? (
            <NumberReveal q={q} answer={reveal.answerNumber} guess={mine?.number?.guess ?? null} />
          ) : (
            <NumberAnswer game={game} q={q} disabled={inert} />
          )
        ) : q.kind === 'order' ? (
          reveal?.answerOrder ? (
            <OrderReveal q={q} reveal={reveal} given={mine?.order?.given ?? null} />
          ) : (
            <OrderAnswer game={game} q={q} disabled={inert} />
          )
        ) : (
          <View style={{ gap: 10 }}>
            {q.options.map((text, i) => (
              <AnswerTile
                // biome-ignore lint/suspicious/noArrayIndexKey: the answers are fixed slots (А–Г)
                key={i}
                index={i}
                text={text}
                game={game}
                inert={inert}
                correct={reveal ? reveal.correct === i : null}
              />
            ))}
          </View>
        )}

        <View style={{ minHeight: 48, justifyContent: 'center', gap: 8 }}>
          {reveal && mine ? (
            q.kind === 'number' && reveal.answerNumber !== undefined ? (
              <NumberSummary result={mine} q={q} answer={reveal.answerNumber} />
            ) : q.kind === 'order' ? (
              <OrderSummary result={mine} />
            ) : (
              <RevealSummary result={mine} />
            )
          ) : !reveal && game.myChoice !== null ? (
            <View style={{ gap: 8 }}>
              <LockStatus game={game} offline={offline} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <ActivePowerups game={game} />
              </View>
            </View>
          ) : active && !out && q.kind === 'choice' ? (
            <PowerupBar game={game} offline={offline} />
          ) : null}
          {reveal?.crowd && <CrowdNote crowd={reveal.crowd} kind={q.kind} />}
        </View>

        {/* Only in a run played alone: with others, the rhythm is everyone's (their facts wait for the results). */}
        {reveal?.fact && alone && <FactNote index={q.index} fact={reveal.fact} waiting={untimedRun} />}
        {reveal && !reveal.fact && game.start.mode === 'solo' && (
          <PauseAfterAnswer index={q.index} waiting={untimedRun} />
        )}
        {untimedRun && !reveal && <UntimedEnding index={q.index} deadline={game.deadline} />}
      </View>
    </View>
  );
}
