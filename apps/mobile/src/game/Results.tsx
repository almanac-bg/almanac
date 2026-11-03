import { actions, fmt, keepTogether, LETTERS, type LiveGame, numberText } from '@almanac/client';
import { MODES } from '@almanac/shared';
import { router } from 'expo-router';
import { View } from 'react-native';
import { radius, useColors } from '@/theme';
import { Button, Screen, T } from '@/ui';

/** After the match: how it went, what it brought, and the questions with their answers. */
export function Results({ game }: { game: LiveGame }) {
  const colors = useColors();
  const end = game.end!;
  const rewards = end.rewards;
  const me = end.standings.find((s) => s.id === game.start.youId);
  const alone = game.start.players.length === 1;
  const right = game.history.filter((i) => i.right).length;
  const daily = rewards?.daily;
  const home = () => {
    actions.closeGame();
    router.replace('/');
  };
  const again = async () => {
    actions.closeGame();
    await actions.startSolo(game.start.category, game.start.pace === 'untimed' ? 'untimed' : 'normal');
  };
  return (
    <Screen>
      <T variant="label" tone="fg3" align="center">
        {MODES[end.mode].name}
      </T>
      <T variant="hero" align="center" role="heading">
        {alone ? `${right} от ${game.history.length}` : me ? `${me.placement}. място` : 'Край'}
      </T>
      <T tone="fg2" align="center">
        {fmt(me?.score ?? 0)} точки
        {!alone ? ` · ${right} от ${game.history.length} верни` : ''}
      </T>

      {end.saving && !rewards && (
        <T variant="small" tone="fg3" align="center">
          Записваме резултата…
        </T>
      )}
      {daily && (
        <Card>
          <T variant="title">
            {daily.offBoard
              ? `Щеше да си ${daily.rank}. от ${daily.total} в днешната класация`
              : `${daily.rank}. място от ${daily.total} днес`}
          </T>
          <T variant="small" tone="fg2">
            🔥 Серия {daily.streak} {daily.streak === 1 ? 'ден' : 'дни'}
          </T>
        </Card>
      )}
      {rewards && (
        <Card>
          <T variant="title">+{fmt(rewards.xpGained)} XP</T>
          {rewards.breakdown.map((line) => (
            <View key={line.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T variant="small" tone="fg2">
                {line.label}
              </T>
              <T variant="small" tone="fg2">
                +{fmt(line.amount)}
              </T>
            </View>
          ))}
          {rewards.levelAfter > rewards.levelBefore && (
            <T variant="bodyStrong" tone="gold">
              ⬆️ Ниво {rewards.levelAfter}!
            </T>
          )}
          {rewards.knowledge.added > 0 && (
            <T variant="small" tone="fg2">
              📖 +{rewards.knowledge.added} в „Моите знания“
            </T>
          )}
        </Card>
      )}

      <View style={{ gap: 10 }}>
        {end.mode === 'solo' && <Button title="Още едно Соло" size="lg" onPress={() => void again()} />}
        <Button title="Към началото" variant={end.mode === 'solo' ? 'secondary' : 'primary'} onPress={home} />
      </View>

      {game.history.length > 0 && (
        <View style={{ gap: 10 }}>
          <T variant="h2" role="heading">
            Въпросите
          </T>
          {game.history.map((item) => (
            <View
              key={item.index}
              accessible
              style={{
                gap: 4,
                padding: 12,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.ink2,
              }}
            >
              <T variant="caption" tone={item.right ? 'good' : 'bad'}>
                {item.index + 1}. {item.right ? 'Верен' : 'Грешен'}
              </T>
              <T variant="bodyStrong">{keepTogether(item.q)}</T>
              <T variant="small" tone="good">
                ✓{' '}
                {item.number
                  ? numberText(item.number.answer, item.number)
                  : item.order
                    ? item.order.right.map((i) => keepTogether(item.order!.items[i])).join(' → ')
                    : `${LETTERS[item.correct]}) ${keepTogether(item.options[item.correct])}`}
              </T>
              {item.fact && (
                <T variant="small" tone="fg2">
                  💡 {keepTogether(item.fact)}
                </T>
              )}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        gap: 6,
        padding: 16,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.glass,
      }}
    >
      {children}
    </View>
  );
}
