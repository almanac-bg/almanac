import { actions, plural, useNow, useStore } from '@almanac/client';
import { MODES } from '@almanac/shared';
import { Modal, View } from 'react-native';
import { useColors } from '@/theme';
import { Avatar, Button, T } from '@/ui';

/** Searching for a match: who you're waiting with, how long it's been, when bots fill in — and the way out. */
export function QueueOverlay() {
  const colors = useColors();
  const queue = useStore((s) => s.queue);
  const since = useStore((s) => s.queueSince);
  const me = useStore((s) => s.me);
  const now = useNow(250, !!queue);
  if (!queue || !me) return null;
  const mode = MODES[queue.mode];
  const elapsed = Math.max(0, Math.floor((now - since) / 1000));
  const botsIn = queue.botFillMs != null ? Math.ceil(queue.botFillMs / 1000) : null;
  const enough = !!mode.minPlayers && queue.found >= mode.minPlayers;
  const seconds = botsIn !== null ? plural(botsIn, 'секунда', 'секунди') : '';
  const botsLine =
    botsIn === null || queue.found >= queue.needed
      ? null
      : botsIn <= 0
        ? 'Започваме…'
        : enough
          ? `След ${seconds} започваме — вече сте ${queue.found}`
          : mode.minPlayers
            ? `След ${seconds} започваме — ботове на твоето ниво допълват до ${mode.minPlayers === 3 ? 'трима' : mode.minPlayers}`
            : queue.mode === 'duel'
              ? `След ${seconds} играеш срещу бот или запис на истински мач на твоето ниво`
              : `След ${seconds} местата се попълват с ботове на твоето ниво`;
  return (
    <Modal visible animationType="fade" onRequestClose={actions.leaveQueue}>
      <View
        style={{
          flex: 1,
          backgroundColor: colors.ink,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 14,
        }}
      >
        <Avatar avatar={me.avatar} frame={me.frame} size={96} />
        <T variant="label" style={{ color: mode.accent[0] }}>
          {mode.name} · {mode.short}
        </T>
        <T variant="h1" role="heading" align="center">
          Търсим играчи…
        </T>
        <T tone="fg2" align="center" accessibilityLiveRegion="polite">
          {queue.found} от {queue.needed} · {elapsed} с
        </T>
        {botsLine && (
          <T variant="small" tone="fg3" align="center">
            {botsLine}
          </T>
        )}
        <Button title="Откажи" variant="secondary" onPress={actions.leaveQueue} />
      </View>
    </Modal>
  );
}
