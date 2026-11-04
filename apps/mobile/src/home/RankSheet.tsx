import { fmt, SCORING_LINE, useStore } from '@almanac/client';
import {
  MODES,
  type QueueModeId,
  RANK_TIERS,
  rankFor,
  SCORING,
  SEASON_MIN_GAMES,
  SEASON_REWARD_XP,
  START_RATING,
} from '@almanac/shared';
import { Modal, ScrollView, View } from 'react-native';
import { RankBadge } from '@/profile/parts';
import { fonts, radius, useColors } from '@/theme';
import { Button, T, useSheetPadding } from '@/ui';

/** What the rank on a ranked mode means (the web's RankInfo): your rating there, the ranks, the points, the season. */
export function RankSheet({ mode, onClose }: { mode: QueueModeId | null; onClose: () => void }) {
  const colors = useColors();
  const sheet = useSheetPadding();
  const rating = useStore((s) => (mode ? (s.me?.ratings[mode] ?? START_RATING) : START_RATING));
  const tier = rankFor(rating);
  return (
    <Modal visible={!!mode} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.ink }} contentContainerStyle={{ ...sheet, gap: 14 }}>
        <T variant="h1" role="heading">
          Рейтинг и рангове
        </T>
        {mode && (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              padding: 14,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.glass,
            }}
          >
            <T variant="small" tone="fg2">
              Твоят рейтинг в „{MODES[mode].name}“:
            </T>
            <RankBadge rating={rating} />
          </View>
        )}
        <T variant="small" tone="fg2">
          Всеки класиран режим има свой рейтинг, който започва от {START_RATING}. След мач той расте за всеки съперник,
          когото изпревариш, и пада за всеки, който те изпревари. Срещу по-силни съперници се печели повече.
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {RANK_TIERS.map((t, i) => {
            const yours = t.id === tier.id;
            const from = i === 0 ? `под ${RANK_TIERS[1]?.min}` : `от ${t.min}`;
            return (
              <View
                key={t.id}
                accessible
                accessibilityLabel={`${t.name}${yours ? ' (ти)' : ''}: ${from}, +${fmt(SEASON_REWARD_XP[t.id])} XP в края на сезона`}
                style={{
                  flexGrow: 1,
                  flexBasis: '45%',
                  padding: 10,
                  borderRadius: radius.md,
                  borderWidth: yours ? 2 : 1,
                  borderColor: yours ? t.color : `${t.color}44`,
                  backgroundColor: `${t.color}10`,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.color }} />
                  <T variant="small" style={{ flex: 1, fontFamily: fonts.bold }}>
                    {t.name}
                  </T>
                  {yours && (
                    <T variant="caption" tone="fg2" style={{ fontFamily: fonts.bold }}>
                      ТИ
                    </T>
                  )}
                </View>
                <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
                  {from} · +{fmt(SEASON_REWARD_XP[t.id])} XP
                </T>
              </View>
            );
          })}
        </View>
        <T variant="small" tone="fg2">
          <T variant="small" style={{ fontFamily: fonts.semibold }}>
            Точките в мача:
          </T>{' '}
          {SCORING_LINE} „Двойно или нищо“ удвоява точките за въпроса (грешка струва {SCORING.doubleStake}), а „Втори
          шанс“ дава половината.
        </T>
        <T variant="small" tone="fg3">
          Сезонът трае месец. В края му получаваш XP за най-високия ранг, достигнат в режим с поне {SEASON_MIN_GAMES}{' '}
          мача (наградата за всеки ранг е показана по-горе). В новия сезон рейтингът започва по-близо до {START_RATING}.
        </T>
        <Button title="Ясно" variant="secondary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
