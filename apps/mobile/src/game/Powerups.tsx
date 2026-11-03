import { actions, type LiveGame } from '@almanac/client';
import { POWERUPS, type PowerupDef } from '@almanac/shared';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import { radius, useColors } from '@/theme';
import { T } from '@/ui';
import { Chip } from './parts';

/** Why a коз can't be played right now, if it can't (the server has the final word). */
function blockedBy(game: LiveGame, p: PowerupDef): string | null {
  if (game.usedPowerups.includes(p.id)) return 'вече е изигран';
  if (game.powerupThisQuestion) return 'само един коз на въпрос';
  if (p.notOnEasy && game.question?.difficulty === 'easy') return 'само на среден и труден въпрос';
  // True or false (a host's own set): taking one away, or a second try, would be the answer.
  if ((p.id === 'fifty' || p.id === 'retry') && (game.question?.options.length ?? 4) < 4)
    return 'не и при вярно/невярно';
  return null;
}

/** Козове already working on this question: the bet's downside stays in view until the answer. */
export function ActivePowerups({ game }: { game: LiveGame }) {
  return (
    <>
      {game.doubled && <Chip text="💰 ×2 точки · грешка −500" tone="gold" />}
      {game.retryArmed && !game.retryPrompt && <Chip text="🔁 „Втори шанс“ е активен" tone="gold" />}
    </>
  );
}

/**
 * The козове, while the question is open: an icon and a word each. One that can't be played says why when it's tapped
 * (a phone has no hover title to tell).
 */
export function PowerupBar({ game, offline }: { game: LiveGame; offline: boolean }) {
  const colors = useColors();
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (game.start.powerups.length === 0) return null;
  const powerups = POWERUPS.filter((p) => game.start.powerups.includes(p.id));
  const explain = (text: string) => {
    clearTimeout(timer.current);
    setHint(text);
    AccessibilityInfo.announceForAccessibility(text);
    timer.current = setTimeout(() => setHint(null), 2200);
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ActivePowerups game={game} />
        {hint && <Chip text={hint} />}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, opacity: offline ? 0.5 : 1 }}>
        {powerups.map((p) => {
          const blocked = blockedBy(game, p);
          const used = game.usedPowerups.includes(p.id);
          return (
            <Pressable
              key={p.id}
              disabled={offline || used}
              onPress={() => (blocked ? explain(`${p.name}: ${blocked}`) : actions.powerup(p.id))}
              accessibilityRole="button"
              accessibilityLabel={p.name}
              accessibilityHint={`${p.description}${blocked ? ` (${blocked})` : ''}`}
              accessibilityState={{ disabled: offline || used || !!blocked }}
              style={{
                flex: 1,
                minHeight: 52,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: used || blocked ? colors.line : 'rgba(251,191,36,0.35)',
                backgroundColor: used || blocked ? 'transparent' : 'rgba(251,191,36,0.1)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: used ? 0.5 : blocked ? 0.6 : 1,
              }}
            >
              <T>{p.icon}</T>
              <T
                variant="caption"
                tone={used || blocked ? 'fg3' : 'gold'}
                style={used ? { textDecorationLine: 'line-through' } : undefined}
              >
                {p.short}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
