import { actions, fmt, useOpenQueues, useStore } from '@almanac/client';
import { MODES, type QueueModeId, START_RATING } from '@almanac/shared';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { radius, useColors } from '@/theme';
import { Card, T } from '@/ui';
import { DuoSheet, useDuoNeed } from './DuoSheet';
import { SoloSheet } from './SoloSheet';

/**
 * „Избери битка“: Соло, and the ranked queues the server has open (their rating and who's searching now). Отбори is two
 * friends together: its tile says what it needs, and a tap asks who with.
 */
export function Modes() {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const lobby = useStore((s) => s.lobby);
  const connected = useStore((s) => s.connected);
  const ranked = useOpenQueues();
  const [soloOpen, setSoloOpen] = useState(false);
  const [duoOpen, setDuoOpen] = useState(false);
  const duoNeed = useDuoNeed(ranked.some((id) => MODES[id].teams));
  // In the queue as a pair: the question of who with is answered.
  const queued = useStore((s) => !!s.queue);
  useEffect(() => {
    if (queued) setDuoOpen(false);
  }, [queued]);
  const [error, setError] = useState<string | null>(null);
  const queue = async (mode: QueueModeId) => {
    if (MODES[mode].teams) return setDuoOpen(true);
    setError(null);
    const res = await actions.joinQueue(mode);
    if (!res.ok) setError(res.error);
  };
  if (!me) return null;
  return (
    <View style={{ gap: 12 }}>
      <T variant="h2" role="heading">
        Избери битка
      </T>
      <ModeTile
        name={MODES.solo.name}
        tagline={MODES.solo.tagline}
        accent={MODES.solo.accent[0]}
        disabled={!connected}
        onPress={() => setSoloOpen(true)}
      />
      {ranked.map((id) => (
        <ModeTile
          key={id}
          name={MODES[id].name}
          tagline={MODES[id].tagline}
          accent={MODES[id].accent[0]}
          detail={`Рейтинг ${fmt(me.ratings[id] ?? START_RATING)}${MODES[id].teams ? ` · ${duoNeed.text}` : lobby?.queues[id] ? ` · ${lobby.queues[id]} търсят` : ''}`}
          disabled={!connected}
          onPress={() => void queue(id)}
        />
      ))}
      {error ? (
        <T variant="small" tone="bad" role="alert">
          {error}
        </T>
      ) : null}
      {!connected && (
        <T variant="small" tone="fg3">
          Свързваме се…
        </T>
      )}
      <SoloSheet open={soloOpen} onClose={() => setSoloOpen(false)} />
      <DuoSheet open={duoOpen} onClose={() => setDuoOpen(false)} />
      <View style={{ height: 1, backgroundColor: colors.line, marginTop: 4 }} />
    </View>
  );
}

function ModeTile({
  name,
  tagline,
  accent,
  detail,
  disabled,
  onPress,
}: {
  name: string;
  tagline: string;
  accent: string;
  detail?: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${tagline}${detail ? `. ${detail}` : ''}`}
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.85 : 1, borderRadius: radius.xl })}
    >
      <Card accent={accent}>
        <T variant="h2" style={{ color: accent }}>
          {name}
        </T>
        <T variant="small" tone="fg2">
          {tagline}
        </T>
        {detail ? (
          <T variant="caption" tone="fg3">
            {detail}
          </T>
        ) : null}
      </Card>
    </Pressable>
  );
}
