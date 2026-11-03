import { actions, useStore } from '@almanac/client';
import { useState } from 'react';
import { Alert, type ViewStyle } from 'react-native';
import { Button } from '@/ui';

/** A Дуел with a friend: the questions now, the friend's turn within a day. The match screen opens by itself. */
export function DuelButton({ friendId, style }: { friendId: number; style?: ViewStyle }) {
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  const [busy, setBusy] = useState(false);
  const duel = async () => {
    setBusy(true);
    const res = await actions.startDuel(friendId);
    setBusy(false);
    if (!res.ok) Alert.alert('Дуелът не започна', res.error);
  };
  return (
    <Button
      title="⚔️ Дуел"
      hint="Изиграваш въпросите сега, а приятелят ти — до един ден"
      loading={busy}
      disabled={inGame}
      onPress={() => void duel()}
      style={style}
    />
  );
}
