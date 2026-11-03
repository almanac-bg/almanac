import { actions, fmt, useOpenQueues, useStore } from '@almanac/client';
import { MODES, type QueueModeId, START_RATING } from '@almanac/shared';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { radius, useColors } from '@/theme';
import { T } from '@/ui';
import { Card } from './Card';
import { SoloSheet } from './SoloSheet';

/**
 * „Избери битка“: Соло, and the ranked queues the server has open (their rating and who's searching now). Отбори — two
 * friends together — comes with the friends' tab.
 */
export function Modes() {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const lobby = useStore((s) => s.lobby);
  const connected = useStore((s) => s.connected);
  const ranked = useOpenQueues().filter((id) => !MODES[id].teams);
  const [soloOpen, setSoloOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = async (mode: QueueModeId) => {
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
          detail={`Рейтинг ${fmt(me.ratings[id] ?? START_RATING)}${lobby?.queues[id] ? ` · ${lobby.queues[id]} търсят` : ''}`}
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
