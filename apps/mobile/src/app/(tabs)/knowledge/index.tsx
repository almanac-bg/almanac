import { api, fmt, plural, useStore } from '@almanac/client';
import { categoryById, type KnowledgeOverview, MASTERY_TIERS } from '@almanac/shared';
import { router } from 'expo-router';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { FactItem, ReviewCard, TierBadge } from '@/knowledge/parts';
import { useLoad } from '@/lib/load';
import { radius, useColors } from '@/theme';
import { Card, LoadError, Progress, Screen, T } from '@/ui';

/** Знания: every fact the player has made theirs, by category, with „Поправителен“ (the web's KnowledgePage). */
export default function Knowledge() {
  // A match just played may have added some, or brought a missed one back: loaded afresh when either changes.
  const version = useStore((s) => `${s.me?.knowledge.facts}:${s.me?.knowledge.due}`);
  const { data, error, loading, reload } = useLoad(() => api.knowledge(), version);
  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      <T variant="h1" role="heading">
        Моите знания
      </T>
      {error && !data ? (
        <LoadError title="Знанията не се заредиха" error={error} onRetry={reload} />
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <Overview data={data} />
      )}
    </Screen>
  );
}

function Overview({ data }: { data: KnowledgeOverview }) {
  const told = `${fmt(data.facts)} от ${plural(data.total, 'факт', 'факта')}`;
  return (
    <>
      <View style={{ gap: 10 }}>
        <T tone="fg2">{told}</T>
        <Progress value={data.total ? data.facts / data.total : 0} label="Моите знания" valueText={told} />
        <T variant="small" tone="fg2">
          Тук остава всеки „Знаеше ли?“ от въпрос, който познаеш, и всеки, който спреш да прочетеш в „Соло“.
        </T>
      </View>

      <ReviewCard queue={data.review} />

      <T variant="h2" role="heading">
        По категории
      </T>
      <View style={{ gap: 10 }}>
        {data.categories.map((c) => (
          <CategoryRow key={c.category} {...c} />
        ))}
      </View>

      {data.recent.length > 0 && (
        <Card>
          <T variant="h2" role="heading">
            Последно научено
          </T>
          <View style={{ gap: 16, marginTop: 4 }}>
            {data.recent.map((f) => (
              <FactItem key={f.id} fact={f} />
            ))}
          </View>
        </Card>
      )}
    </>
  );
}

function CategoryRow({ category, facts, total, tier }: KnowledgeOverview['categories'][number]) {
  const colors = useColors();
  const cat = categoryById(category);
  if (!cat) return null;
  const tierName = tier !== null ? MASTERY_TIERS[tier]?.name : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${cat.name}: ${fmt(facts)} от ${plural(total, 'факт', 'факта')}${tierName ? `, ${tierName}` : ''}`}
      accessibilityHint="Отваря фактите от категорията"
      onPress={() => router.push({ pathname: '/knowledge/[category]', params: { category } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.lineStrong : colors.glass,
      })}
    >
      <T style={{ fontSize: 30, lineHeight: 38 }}>{cat.icon}</T>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 }}>
          <T variant="bodyStrong">{cat.name}</T>
          {tier !== null && <TierBadge tier={tier} />}
        </View>
        <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
          {fmt(facts)} / {fmt(total)}
        </T>
        <Progress value={total ? facts / total : 0} color={cat.color} height={6} />
      </View>
      <ChevronRight color={colors.fg3} size={18} />
    </Pressable>
  );
}
