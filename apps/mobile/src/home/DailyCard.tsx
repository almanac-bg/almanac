import { actions, useStore } from '@almanac/client';
import { MODES } from '@almanac/shared';
import { useState } from 'react';
import { Button, T } from '@/ui';
import { Card } from './Card';

/** The day's ten: to play, or played (with the streak either way). One attempt until midnight. */
export function DailyCard() {
  const daily = useStore((s) => s.me!.daily);
  const connected = useStore((s) => s.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const play = async () => {
    setBusy(true);
    setError(null);
    const started = await actions.startDaily();
    if (!started.ok) setError(started.error);
    setBusy(false);
  };
  return (
    <Card accent={MODES.daily.accent[0]}>
      <T variant="label" tone="fg3">
        Въпросите на деня
      </T>
      <T variant="h2" role="heading">
        {daily.played ? 'Днешните са изиграни' : '10 въпроса, едни и същи за цяла България'}
      </T>
      <T variant="small" tone="fg2">
        {daily.played
          ? `🔥 Серия ${daily.streak}. Утре — нови десет.`
          : `Около три минути, един опит до полунощ.${daily.streak ? ` 🔥 Серия ${daily.streak}.` : ''}`}
      </T>
      {!daily.played && (
        <Button
          title="Играй въпросите на деня"
          size="lg"
          loading={busy}
          disabled={!connected}
          onPress={() => void play()}
        />
      )}
      {error ? (
        <T variant="small" tone="bad" role="alert">
          {error}
        </T>
      ) : null}
    </Card>
  );
}
