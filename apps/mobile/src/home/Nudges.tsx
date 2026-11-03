import { plural, useStore } from '@almanac/client';
import { REVIEW } from '@almanac/shared';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useStartReview } from '@/knowledge/parts';
import { fonts, radius, useColors } from '@/theme';
import { Button, T } from '@/ui';

/** A one-line nudge at the top of Играй, in the colour of what it's about. */
function Nudge({ color, icon, children }: { color: string; icon: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: `${color}55`,
        backgroundColor: `${color}14`,
      }}
    >
      <T style={{ fontSize: 22, lineHeight: 28 }}>{icon}</T>
      {children}
    </View>
  );
}

/** „Поправителен“ ready: a run of the missed questions that came back (how many it plays, not the pile), a tap away. */
export function ReviewTurn() {
  const colors = useColors();
  const due = useStore((s) => s.me?.knowledge.due ?? 0);
  const { busy, start } = useStartReview();
  if (due < REVIEW.min) return null;
  return (
    <Nudge color={colors.good} icon="📒">
      <T variant="small" style={{ flex: 1 }}>
        <T variant="small" style={{ fontFamily: fonts.bold }}>
          Поправителен:
        </T>{' '}
        <T variant="small" tone="fg2">
          {plural(Math.min(due, REVIEW.size), 'въпрос за нов опит', 'въпроса за нов опит')}
        </T>
      </T>
      <Button title="Играй" label="Играй Поправителен" loading={busy} onPress={() => void start()} />
    </Nudge>
  );
}

const NUDGE_KEY = 'almanac.email-nudge';

/**
 * Without a verified email a forgotten password means a lost account: a nudge until one is added (the web's
 * EmailNudge). Not for a guest (saving the account asks for one), and not before a few matches: a newcomer's first
 * screen is for playing. Hidden for good with ✕.
 */
export function EmailNudge() {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => {
    void SecureStore.getItemAsync(NUDGE_KEY).then(
      (v) => setHidden(v === '1'),
      () => setHidden(false),
    );
  }, []);
  if (!me || hidden !== false || me.isGuest || me.email || me.pendingEmail || me.stats.games < 5) return null;
  const hide = () => {
    setHidden(true);
    void SecureStore.setItemAsync(NUDGE_KEY, '1').catch(() => {});
  };
  return (
    <Nudge color={colors.violet} icon="✉️">
      <View style={{ flex: 1, gap: 8 }}>
        <T variant="small">Добави имейл, за да можеш да възстановиш паролата си, ако я забравиш.</T>
        <Button
          title="Добави имейл"
          variant="secondary"
          onPress={() => router.push('/settings')}
          style={{ alignSelf: 'flex-start' }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Скрий"
        onPress={hide}
        hitSlop={8}
        style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}
      >
        <T tone="fg3">✕</T>
      </Pressable>
    </Nudge>
  );
}
