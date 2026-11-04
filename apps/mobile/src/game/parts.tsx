import { actions, fmt, keepTogether, LETTERS, type LiveGame, OPTION_COLORS, percent, useNow } from '@almanac/client';
import type { Crowd, PlayerResult, QuestionPayload } from '@almanac/shared';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { tick } from '@/lib/sounds';
import { fonts, radius, useColors } from '@/theme';
import { IconText, T } from '@/ui';

/** A small label on the question: its category, its difficulty, the final. */
export function Chip({ text, icon, tone = 'fg2' }: { text: string; icon?: string; tone?: 'fg2' | 'gold' | 'bad' }) {
  const colors = useColors();
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.glass,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <IconText icon={icon} variant="caption" tone={tone} style={{ fontFamily: fonts.bold }}>
        {text}
      </IconText>
    </View>
  );
}

/**
 * The question's clock: a ring that drains, its colour going from calm to urgent, and the seconds in it. Without a clock
 * (Соло's „Без часовник“), the sign that there's none.
 */
export function TimerRing({
  deadline,
  duration,
  stopped,
  untimed,
}: {
  deadline: number;
  duration: number;
  stopped: boolean;
  untimed: boolean;
}) {
  const colors = useColors();
  const now = useNow(100, !stopped && !untimed);
  const size = 56;
  const left = untimed ? 0 : Math.ceil(Math.max(0, deadline - now) / 1000);
  // The last five seconds tick, higher with each of the last three; not once the answer is in.
  useEffect(() => {
    if (!stopped && !untimed && left > 0 && left <= 5) tick(left);
  }, [left, stopped, untimed]);
  if (untimed)
    return (
      <View
        accessible
        accessibilityLabel="Без часовник"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3.5,
          borderColor: colors.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <T variant="h2" tone="fg3">
          ∞
        </T>
      </View>
    );
  const remaining = Math.max(0, deadline - now);
  const secs = Math.ceil(remaining / 1000);
  const share = Math.min(1, remaining / duration);
  const color = share > 0.5 ? '#22d3ee' : share > 0.25 ? colors.gold : colors.bad;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`Оставащо време: ${secs} ${secs === 1 ? 'секунда' : 'секунди'}`}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
      >
        <Circle cx={32} cy={32} r={r} fill="none" stroke={colors.line} strokeWidth={5} />
        <Circle
          cx={32}
          cy={32}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
        />
      </Svg>
      {/* The clock's digits keep to their ring, whatever the text size: the one place the app caps it (MOBILE-13). */}
      <T variant="h2" style={{ color, fontVariant: ['tabular-nums'] }} maxFontSizeMultiplier={1.2}>
        {secs}
      </T>
    </View>
  );
}

type TileState = 'idle' | 'selected' | 'dim' | 'correct' | 'wrong';

/**
 * One of the answers, А–Г: tapped to pick it. At the reveal the right one fills in green and a wrong pick is struck
 * through in red — told apart by more than colour, as on the web.
 */
export function AnswerTile({
  index,
  text,
  game,
  inert,
  correct,
}: {
  index: number;
  text: string;
  game: LiveGame;
  inert: boolean;
  correct: boolean | null;
}) {
  const colors = useColors();
  const selected = game.myChoice === index;
  const removed = game.removed.includes(index);
  const revealed = correct !== null;
  const wrongPick = revealed && selected && !correct;
  const state: TileState = revealed
    ? correct
      ? 'correct'
      : wrongPick
        ? 'wrong'
        : 'dim'
    : selected
      ? 'selected'
      : game.myChoice !== null
        ? 'dim'
        : 'idle';
  const accent = OPTION_COLORS[index];
  const status = [
    removed && 'премахнат',
    state === 'correct' && (selected ? 'верен отговор, твоят избор' : 'верен отговор'),
    wrongPick && 'твоят избор, грешен',
    !revealed && selected && 'твоят избор',
  ].filter(Boolean);
  const off = inert || removed || game.myChoice !== null;
  return (
    <Pressable
      onPress={() => !off && actions.answer(index)}
      accessibilityRole="button"
      accessibilityLabel={`${LETTERS[index]}) ${text}${status.length ? ` — ${status.join(' — ')}` : ''}`}
      accessibilityState={{ disabled: off, selected }}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: state === 'wrong' ? 2 : 1,
        borderColor:
          state === 'correct'
            ? colors.good
            : state === 'wrong'
              ? colors.bad
              : state === 'selected'
                ? accent
                : colors.line,
        backgroundColor: state === 'correct' ? colors.good : colors.ink2,
        opacity: removed ? 0.25 : state === 'dim' ? 0.45 : 1,
        transform: [{ scale: pressed && !off ? 0.98 : 1 }],
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: state === 'wrong' ? colors.bad : state === 'correct' ? 'rgba(0,0,0,0.12)' : `${accent}22`,
        }}
      >
        <T
          variant="title"
          style={{ color: state === 'correct' ? colors.onFill : state === 'wrong' ? '#0b0a14' : accent }}
        >
          {state === 'correct' ? '✓' : state === 'wrong' ? '✕' : LETTERS[index]}
        </T>
      </View>
      <T
        variant="bodyStrong"
        style={[
          { flex: 1 },
          state === 'correct' && { color: colors.onFill },
          (removed || state === 'wrong') && { textDecorationLine: 'line-through' },
        ]}
      >
        {keepTogether(text)}
      </T>
    </Pressable>
  );
}

/** How your answer went: its points (with ×2, the second chance, the streak, the time) or why there are none. */
export function RevealSummary({ result }: { result: PlayerResult }) {
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}
      accessibilityLiveRegion="polite"
    >
      {result.correct ? (
        <>
          <T variant="h1" tone="good">
            +{fmt(result.points)}
          </T>
          {result.doubled && <Chip text="×2" tone="gold" />}
          {result.retried && <Chip text="🔁 Втори шанс · ½ точки" tone="gold" />}
          {result.streak >= 2 && <Chip text={`🔥 Серия ${result.streak}`} tone="gold" />}
          {result.timeMs !== null && (
            <T variant="small" tone="fg3">
              за {(result.timeMs / 1000).toFixed(1).replace('.', ',')} с
            </T>
          )}
        </>
      ) : (
        <>
          <T variant="h2" tone="bad">
            {result.choice === null ? 'Времето изтече ⏱️' : 'Грешно 😬'}
          </T>
          {result.points < 0 && <Chip text={`💰 −${fmt(-result.points)}`} tone="bad" />}
        </>
      )}
    </View>
  );
}

/** A pick counts once the server has it (it echoes `answered`): until then this says so, instead of claiming a lock. */
export function LockStatus({ game, offline }: { game: LiveGame; offline: boolean }) {
  if (!game.answered.includes(game.start.youId))
    return offline ? (
      <T variant="small" tone="bad">
        Отговорът не е потвърден — няма връзка
      </T>
    ) : (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator size="small" />
        <T variant="small" tone="fg2">
          Изпращаме отговора…
        </T>
      </View>
    );
  const playing = game.start.players.length - game.eliminated.length;
  return (
    <T variant="small" tone="fg2">
      ✓ Отговорът е заключен
      {game.start.players.length > 1 ? ` · ${game.answered.length}/${playing} са отговорили` : ''}
    </T>
  );
}

/** „62% знаят“: how everyone who played this question before did on it (once enough have). */
export function CrowdNote({ crowd, kind }: { crowd: Crowd; kind: QuestionPayload['kind'] }) {
  const share = percent(crowd.known);
  return (
    <T variant="small" tone="fg3">
      {kind === 'number'
        ? `${share} бяха близо`
        : kind === 'order'
          ? `${share} подредиха всичко`
          : crowd.known < 0.1
            ? `Само ${share} знаят`
            : `${share} знаят`}{' '}
      · от {fmt(crowd.answers)} отговора
    </T>
  );
}
