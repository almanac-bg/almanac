import { actions } from '@almanac/client';
import { emoteById } from '@almanac/shared';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { play } from '@/lib/sounds';
import { radius, useColors } from '@/theme';
import { T } from '@/ui';

/** A button under the answers that opens the match's reactions; one sent, the tray closes (and waits a moment). */
export function Emotes({ emotes, offline }: { emotes: string[]; offline: boolean }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  if (!emotes.length) return null;
  const send = (id: string) => {
    if (cooldown || offline) return;
    actions.react(id);
    play('pop');
    setOpen(false);
    setCooldown(true);
    setTimeout(() => setCooldown(false), 800);
  };
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
      {open && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 4,
            padding: 6,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.ink2,
          }}
        >
          {emotes.map((id) => (
            <Pressable
              key={id}
              onPress={() => send(id)}
              disabled={offline}
              accessibilityRole="button"
              accessibilityLabel={`Емоция: ${emoteById(id)?.name ?? ''}`}
              style={{
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: cooldown || offline ? 0.5 : 1,
              }}
            >
              <T style={{ fontSize: 24, lineHeight: 30 }}>{emoteById(id)?.emoji}</T>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel="Емоции"
        accessibilityState={{ expanded: open }}
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.ink2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <T style={{ fontSize: 22, lineHeight: 28 }}>{open ? '✕' : '😀'}</T>
      </Pressable>
    </View>
  );
}
