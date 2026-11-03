import { actions, fmt, keepTogether, LETTERS, type LiveGame, orderValueText } from '@almanac/client';
import { ORDER, type PlayerResult, type QuestionPayload, type RevealPayload } from '@almanac/shared';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { radius, useColors } from '@/theme';
import { Button, T } from '@/ui';
import { Chip } from './parts';

/**
 * „Подреди“: the four things are tapped in the order they go, each moving up to its place with its number; a tap on a
 * placed one takes it back out. Once it's in, the order stays on show.
 */
export function OrderAnswer({ game, q, disabled }: { game: LiveGame; q: QuestionPayload; disabled: boolean }) {
  const colors = useColors();
  const items = q.order!.items;
  const locked = game.myChoice !== null;
  const [picked, setPicked] = useState<number[]>([]);
  const order = locked && game.myOrder ? game.myOrder : picked;
  const inert = disabled || locked;
  const complete = order.length === items.length;
  const toggle = (item: number) =>
    setPicked((p) => (p.includes(item) ? p.filter((i) => i !== item) : p.length < items.length ? [...p, item] : p));
  // The placed ones first, in their order; the rest after them as shown.
  const rows = [...order, ...items.map((_, i) => i).filter((i) => !order.includes(i))];
  return (
    <View style={{ gap: 8 }}>
      {!locked && (
        <T variant="caption" tone="fg3" align="center">
          Докосни ги в реда, в който вървят · по {ORDER.perItem} точки за всяко на мястото му
        </T>
      )}
      {rows.map((item) => {
        const place = order.indexOf(item);
        const placed = place >= 0;
        return (
          <Pressable
            key={item}
            onPress={() => !inert && toggle(item)}
            disabled={inert}
            accessibilityRole="button"
            accessibilityLabel={`${LETTERS[item]}) ${items[item]} — ${placed ? `на място ${place + 1}` : 'не е подредено'}`}
            accessibilityState={{ selected: placed, disabled: inert }}
            style={{
              minHeight: 56,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: placed ? (locked ? colors.good : colors.violet) : colors.line,
              backgroundColor: colors.ink2,
              opacity: inert && !placed ? 0.45 : 1,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: placed ? (locked ? colors.good : colors.violet) : 'transparent',
                borderWidth: placed ? 0 : 1,
                borderStyle: 'dashed',
                borderColor: colors.lineStrong,
              }}
            >
              <T variant="title" style={placed ? { color: colors.onFill } : undefined} tone={placed ? 'fg' : 'fg3'}>
                {placed ? place + 1 : LETTERS[item]}
              </T>
            </View>
            <T variant="bodyStrong" style={{ flex: 1 }}>
              {keepTogether(items[item])}
            </T>
          </Pressable>
        );
      })}
      {!locked && (
        <Button
          title={complete ? 'Заключи' : `Подредени ${order.length} от ${items.length}`}
          size="lg"
          disabled={!complete || inert}
          onPress={() => !inert && complete && actions.arrange(picked)}
        />
      )}
    </View>
  );
}

/** The right order, after: each thing with its value, and which of yours were in place. */
export function OrderReveal({
  q,
  reveal,
  given,
}: {
  q: QuestionPayload;
  reveal: RevealPayload;
  given: number[] | null;
}) {
  const colors = useColors();
  const answer = reveal.answerOrder!;
  return (
    <View style={{ gap: 6 }}>
      {answer.order.map((item, place) => {
        const right = given?.[place] === item;
        return (
          <View
            key={item}
            accessible
            accessibilityLabel={`${place + 1}. ${q.order!.items[item]}${answer.values ? ` (${orderValueText(answer.values[item], answer.unit)})` : ''}${given ? (right ? ' — на мястото си' : ' — не на мястото си') : ''}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: 10,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: given ? (right ? colors.good : colors.line) : colors.line,
              backgroundColor: colors.ink2,
            }}
          >
            <T variant="title" tone={right ? 'good' : 'fg3'}>
              {place + 1}
            </T>
            <T variant="bodyStrong" style={{ flex: 1 }}>
              {keepTogether(q.order!.items[item])}
              {answer.values ? (
                <T variant="small" tone="fg3">
                  {' '}
                  · {orderValueText(answer.values[item], answer.unit)}
                </T>
              ) : null}
            </T>
            {given && <T tone={right ? 'good' : 'bad'}>{right ? '✓' : '✕'}</T>}
          </View>
        );
      })}
    </View>
  );
}

/** How your order did: its points, how many were in place, and the streak it kept (all of them right). */
export function OrderSummary({ result }: { result: PlayerResult }) {
  if (!result.order?.given)
    return (
      <T variant="h2" tone="bad">
        Времето изтече ⏱️
      </T>
    );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      <T variant="h1" tone={result.points > 0 ? 'good' : 'bad'}>
        +{fmt(result.points)}
      </T>
      <Chip
        text={result.correct ? '🎯 Всичко на място!' : `${result.order.right} от ${ORDER.items} на място`}
        tone={result.correct ? 'gold' : 'fg2'}
      />
      {result.streak >= 2 && <Chip text={`🔥 Серия ${result.streak}`} tone="gold" />}
    </View>
  );
}
