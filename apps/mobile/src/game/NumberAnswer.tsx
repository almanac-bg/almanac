import { actions, fmt, type LiveGame, maxDigits, numberText, offText, unitFor } from '@almanac/client';
import { decimalsOf, isExact, type PlayerResult, type QuestionPayload, snapNumber } from '@almanac/shared';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Button, T } from '@/ui';
import { Chip } from './parts';

/** Typed text as a number: a comma for the decimals, a minus in front; null while it's no number yet. */
function parse(text: string): number | null {
  if (!/\d/.test(text)) return null;
  const value = Number(text.replace(',', '.').replace('−', '-'));
  return Number.isFinite(value) ? value : null;
}

/**
 * The answer to a number question: typed on a keypad of its own (the phone's keyboard would cover half the screen),
 * then locked in. Once it's in, the number stays on show.
 */
export function NumberAnswer({ game, q, disabled }: { game: LiveGame; q: QuestionPayload; disabled: boolean }) {
  const colors = useColors();
  const n = q.number!;
  const locked = game.myChoice !== null;
  const [text, setText] = useState('');
  const value = parse(text);
  const valid = value !== null && value >= n.min && value <= n.max;
  const decimals = decimalsOf(n.step) > 0;
  const inert = disabled || locked;

  const type = (key: string) =>
    setText((t) => {
      if (key === ',') return decimals && !t.includes(',') ? `${t || '0'},` : t;
      if (key === '−') return t.startsWith('−') ? t.slice(1) : `−${t}`;
      if (t.replace(/[^\d]/g, '').length >= maxDigits(n)) return t;
      // No leading zeros („007“), but „0,5“ is fine.
      return t === '0' || t === '−0' ? t.slice(0, -1) + key : t + key;
    });
  const submit = () => {
    if (valid && !inert) actions.guess(snapNumber(value, n));
  };

  const shown = locked && game.myGuess !== null ? game.myGuess : value;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? ',' : n.min < 0 ? '−' : '', '0', '⌫'];
  return (
    <View style={{ gap: 10 }}>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={shown === null ? 'Още няма число' : `Твоят отговор: ${numberText(shown, n)}`}
        style={{
          minHeight: 64,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: locked ? colors.good : text && !valid ? colors.bad : colors.line,
          backgroundColor: colors.ink2,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
        }}
      >
        <T style={{ fontFamily: fonts.display, fontSize: 32, lineHeight: 40 }} tone={shown === null ? 'fg3' : 'fg'}>
          {locked && shown !== null ? `🔒 ${numberText(shown, { ...n, unit: '' })}` : text || '?'}
        </T>
        {n.unit && shown !== null ? (
          <T variant="title" tone="fg2">
            {unitFor(shown, n.unit)}
          </T>
        ) : null}
      </View>
      {!locked && (
        <>
          <T variant="caption" tone={text && !valid ? 'bad' : 'fg3'} align="center">
            от {numberText(n.min, n)} до {numberText(n.max, n)}
            {q.times > 1 ? ` · финалът носи ×${q.times}` : ''}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {keys.map((key, i) =>
              key ? (
                <Pressable
                  key={key}
                  onPress={() => !inert && (key === '⌫' ? setText((t) => t.slice(0, -1)) : type(key))}
                  disabled={inert}
                  accessibilityRole="button"
                  accessibilityLabel={key === '⌫' ? 'Изтрий' : key === '−' ? 'Минус' : key === ',' ? 'Запетая' : key}
                  style={({ pressed }) => ({
                    width: '31.5%',
                    minHeight: 52,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.line,
                    backgroundColor: pressed ? colors.glass : colors.ink2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  })}
                >
                  <T variant="h2">{key}</T>
                </Pressable>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: an empty slot in a fixed keypad
                <View key={i} style={{ width: '31.5%' }} />
              ),
            )}
          </View>
          <Button title="Заключи" size="lg" disabled={!valid || inert} onPress={submit} />
        </>
      )}
    </View>
  );
}

/** The answer, after: the right number, and yours beside it with how far off it was. */
export function NumberReveal({ q, answer, guess }: { q: QuestionPayload; answer: number; guess: number | null }) {
  const n = q.number!;
  return (
    <View style={{ gap: 6 }}>
      <T variant="h2" tone="good" align="center">
        ✓ {numberText(answer, n)}
      </T>
      <T variant="small" tone="fg2" align="center">
        {guess === null ? 'Без отговор' : `Ти: ${numberText(guess, n)} (${offText(guess, answer, n)})`}
      </T>
    </View>
  );
}

/** How your number did: its points, spot on or how far off, and the streak it kept. */
export function NumberSummary({ result, q, answer }: { result: PlayerResult; q: QuestionPayload; answer: number }) {
  const n = q.number!;
  const guess = result.number?.guess ?? null;
  if (guess === null)
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
      {isExact(guess, { answer, step: n.step }) ? (
        <Chip text="🎯 Точно!" tone="gold" />
      ) : (
        <Chip text={`${result.points > 0 ? '' : 'Твърде далеч · '}${offText(guess, answer, n)}`} />
      )}
      {result.streak >= 2 && <Chip text={`🔥 Серия ${result.streak}`} tone="gold" />}
    </View>
  );
}
