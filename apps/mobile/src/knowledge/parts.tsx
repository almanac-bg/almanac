import { actions, factAnswer, keepTogether, plural, timeAgo } from '@almanac/client';
import { type KnowledgeFact, MASTERY_TIERS, REVIEW, type ReviewQueue } from '@almanac/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { pictureUri } from '@/lib/images';
import { fonts, radius, useColors } from '@/theme';
import { Button, Card, T } from '@/ui';

/** A category's mastery tier, as a small badge: „🥈 Експерт“. */
export function TierBadge({ tier }: { tier: number }) {
  const colors = useColors();
  const t = MASTERY_TIERS[tier];
  if (!t) return null;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: `${colors.good}1f`,
      }}
    >
      <T variant="caption" tone="good" style={{ fontFamily: fonts.bold }}>
        {t.icon} {t.name}
      </T>
    </View>
  );
}

const THUMB_HEIGHT = 48;
const THUMB_MAX_WIDTH = 80;

/** One fact of „Моите знания“: its question and answer, small, then the fact itself (the web's FactItem). */
export function FactItem({ fact }: { fact: KnowledgeFact }) {
  const colors = useColors();
  const width = fact.image ? Math.min(THUMB_MAX_WIDTH, (THUMB_HEIGHT * fact.image.w) / fact.image.h) : 0;
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {fact.image && (
        <Image
          source={{ uri: pictureUri(fact.image, width) }}
          accessibilityLabel={fact.image.alt}
          contentFit="cover"
          style={{
            width,
            height: THUMB_HEIGHT,
            marginTop: 2,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        />
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <T variant="caption" tone="fg3">
          {keepTogether(fact.q)} —{' '}
          <T variant="caption" tone="good" style={{ fontFamily: fonts.semibold }}>
            {factAnswer(fact)}
          </T>
        </T>
        <T>{keepTogether(fact.fact)}</T>
      </View>
    </View>
  );
}

/** What „Поправителен“ has now: ready to play, waiting for a few more, or when the next one comes back. */
export function reviewLine(queue: ReviewQueue): string {
  if (queue.ready)
    return `${plural(Math.min(queue.due, REVIEW.size), 'сгрешен въпрос е готов', 'сгрешени въпроса са готови')} за нов опит. Помниш ли ги сега?`;
  if (queue.due > 0)
    return `${plural(queue.due, 'въпрос се върна', 'въпроса се върнаха')}: играе се, щом станат поне ${REVIEW.min}.`;
  if (queue.waiting === 0 || queue.nextDueAt === null)
    return `Сгрешеното се връща тук след ${REVIEW.afterDays.join(', ').replace(/, (\d+)$/, ' и $1')} дни — докато го запомниш.`;
  return `${plural(queue.waiting, 'сгрешен въпрос чака', 'сгрешени въпроса чакат')}: следващият се връща ${timeAgo(queue.nextDueAt)}.`;
}

/** Starts „Поправителен“ (the match screen opens by itself once it does). */
export function useStartReview() {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const res = await actions.startReview();
    setBusy(false);
    if (!res.ok) Alert.alert('Поправителният не започна', res.error);
  };
  return { busy, start };
}

/**
 * „Поправителен“: the questions missed a few days ago, back to be answered again (the web's ReviewCard). Started, the
 * match screen opens by itself (lib/realtime).
 */
export function ReviewCard({ queue }: { queue: ReviewQueue }) {
  const colors = useColors();
  const { busy, start } = useStartReview();
  return (
    <Card accent={queue.ready ? colors.good : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <T style={{ fontSize: 34, lineHeight: 42 }} accessibilityElementsHidden importantForAccessibility="no">
          📒
        </T>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="h2" role="heading">
            Поправителен
          </T>
          <T variant="small" tone="fg2">
            {reviewLine(queue)}
          </T>
        </View>
      </View>
      {queue.ready && <Button title="Играй" variant="gold" loading={busy} onPress={() => void start()} />}
    </Card>
  );
}
