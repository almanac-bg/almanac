import { api, factMatches, fmt, plural, searchWords } from '@almanac/client';
import { type CategoryId, categoryById, isCategoryId, type KnowledgeCategoryPage } from '@almanac/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Search from 'lucide-react-native/icons/search';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, TextInput, View } from 'react-native';
import { FactItem, TierBadge } from '@/knowledge/parts';
import { useLoad } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { Button, Card, COLUMN, LoadError, Progress, Screen, T, usePagePadding } from '@/ui';

/** With more than this many facts a search comes over them (as on the web). */
const SEARCH_FROM = 8;

/** One category's facts, newest first, with a search once there are enough to need one (the web's CategoryFacts). */
export default function CategoryFacts() {
  const { category } = useLocalSearchParams<{ category: string }>();
  if (!isCategoryId(category)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Знания' }} />
        <T variant="title">Няма такава категория</T>
        <Button title="Към знанията" variant="secondary" onPress={() => router.replace('/knowledge')} />
      </Screen>
    );
  }
  return <Facts category={category} />;
}

function Facts({ category }: { category: CategoryId }) {
  const colors = useColors();
  const padding = usePagePadding();
  const cat = categoryById(category)!;
  const { data, error, loading, reload } = useLoad(() => api.knowledgeCategory(category), category);
  const [query, setQuery] = useState('');
  const words = searchWords(useDeferredValue(query));
  const shown = data && words.length ? data.facts.filter((f) => factMatches(f, words)) : (data?.facts ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <Stack.Screen options={{ title: cat.name }} />
      <FlatList
        data={data ? shown : []}
        keyExtractor={(f) => f.id}
        renderItem={({ item }) => (
          <Card style={{ ...COLUMN, marginBottom: 10 }}>
            <FactItem fact={item} />
          </Card>
        )}
        // Long categories have hundreds: drawn as they scroll into view, not all at once.
        initialNumToRender={8}
        windowSize={7}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={padding}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.fg3} />}
        ListHeaderComponent={
          <View style={[COLUMN, { gap: 14, marginBottom: 16 }]}>
            {error && !data ? (
              <LoadError title="Знанията не се заредиха" error={error} onRetry={reload} />
            ) : !data ? (
              <ActivityIndicator style={{ marginTop: 40 }} />
            ) : (
              <Head page={data} color={cat.color} icon={cat.icon} />
            )}
            {data && data.facts.length > SEARCH_FROM && (
              <SearchField value={query} onChange={setQuery} label={`Търси във фактите от „${cat.name}“`} />
            )}
          </View>
        }
        ListEmptyComponent={
          !data ? undefined : data.facts.length === 0 ? (
            <View style={[COLUMN, { gap: 6, alignItems: 'center', paddingVertical: 24 }]}>
              <T style={{ fontSize: 34, lineHeight: 42 }}>📖</T>
              <T variant="title" align="center">
                Още нищо тук
              </T>
              <T tone="fg2" align="center">
                Отговори вярно на въпрос от „{cat.name}“ — фактът зад него ще остане тук.
              </T>
            </View>
          ) : (
            <T tone="fg3" align="center" style={COLUMN} accessibilityLiveRegion="polite">
              Нищо не съвпада с „{query.trim()}“.
            </T>
          )
        }
      />
    </View>
  );
}

function Head({ page, color, icon }: { page: KnowledgeCategoryPage; color: string; icon: string }) {
  const told = `${fmt(page.facts.length)} от ${plural(page.total, 'факт', 'факта')}`;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <T style={{ fontSize: 40, lineHeight: 48 }} accessibilityElementsHidden importantForAccessibility="no">
          {icon}
        </T>
        <View style={{ flex: 1, gap: 4 }}>
          <T tone="fg2">{told}</T>
          {page.tier !== null && <TierBadge tier={page.tier} />}
        </View>
      </View>
      <Progress
        value={page.total ? page.facts.length / page.total : 0}
        color={color}
        label="Събрани"
        valueText={told}
      />
    </>
  );
}

function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 50,
        paddingHorizontal: 14,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.lineStrong,
        backgroundColor: colors.ink2,
      }}
    >
      <Search color={colors.fg3} size={18} />
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        placeholder="Търси във фактите"
        placeholderTextColor={colors.fg3}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={{ flex: 1, minHeight: 48, color: colors.fg, fontFamily: fonts.regular, fontSize: 16 }}
      />
    </View>
  );
}
