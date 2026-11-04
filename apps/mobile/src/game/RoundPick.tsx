import { actions, type LiveGame, useNow } from '@almanac/client';
import { categoryById } from '@almanac/shared';
import { View } from 'react-native';
import { Button, IconText, T } from '@/ui';

/** A round's category, picked by whoever is asked (the others watch it being picked). */
export function RoundPick({ game }: { game: LiveGame }) {
  const pick = game.pick!;
  const now = useNow(250, !pick.chosen);
  const secs = Math.max(0, Math.ceil((pick.endsAt - now) / 1000));
  const mine = pick.pickerId === game.start.youId;
  const chosen = pick.chosen ? categoryById(pick.chosen) : null;
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
      <T variant="label" tone="fg3" align="center">
        Рунд {pick.round + 1}
      </T>
      <IconText icon={chosen?.icon} variant="h1" align="center" role="heading">
        {chosen ? chosen.name : mine ? 'Избери категория' : 'Избира се категория…'}
      </IconText>
      {!chosen && (
        <T variant="small" tone="fg3" align="center">
          {secs} с
        </T>
      )}
      {!chosen &&
        mine &&
        pick.options.map((id) => {
          const cat = categoryById(id);
          return (
            <Button
              key={id}
              title={cat ? cat.name : id}
              icon={cat?.icon}
              variant={pick.sent === id ? 'primary' : 'secondary'}
              disabled={!!pick.sent}
              onPress={() => actions.pickCategory(id)}
            />
          );
        })}
    </View>
  );
}
