import { useStore } from '@almanac/client';
import { levelProgress, SUBMISSION_RULES } from '@almanac/shared';
import { router } from 'expo-router';
import { useColors } from '@/theme';
import { Button, Card, T } from '@/ui';

/** „Общност“ on Играй (the web's CommunityCard): a question of your own for the game, once your level allows it. */
export function CommunityCard() {
  const colors = useColors();
  const level = useStore((s) => (s.me ? levelProgress(s.me.xp).level : 0));
  const guest = useStore((s) => !!s.me?.isGuest);
  if (guest || level < SUBMISSION_RULES.minLevel) return null;
  return (
    <Card accent={colors.good}>
      <T variant="label" tone="good">
        Общност
      </T>
      <T variant="h2" role="heading">
        Предложи въпрос
      </T>
      <T variant="small" tone="fg3">
        Знаеш нещо интересно? Изпрати въпрос — одобрените влизат в играта с твоето име и +{SUBMISSION_RULES.approvedXp}{' '}
        XP.
      </T>
      <Button title="Напиши въпрос" icon="✍️" variant="secondary" onPress={() => router.push('/submit')} />
    </Card>
  );
}
