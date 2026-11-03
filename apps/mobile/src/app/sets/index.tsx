import { api, errorMessage, timeAgo, toast, useStore } from '@almanac/client';
import { SETS } from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLoad, useReloadOnFocus } from '@/lib/load';
import { playInRoom } from '@/sets/parts';
import { radius, useColors } from '@/theme';
import { Button, Card, LoadError, Screen, T } from '@/ui';

const openSet = (id: number) => router.push({ pathname: '/sets/[id]', params: { id: String(id) } });

/** Моите въпроси (the web's SetList): your own sets for your rooms, each a tap from its editor or a room. */
export default function Sets() {
  const colors = useColors();
  const guest = useStore((s) => !!s.me?.isGuest);
  const { data, error, loading, reload } = useLoad(() => (guest ? Promise.resolve(null) : api.sets()), String(guest));
  // Back from a set: its count and name as saved.
  useReloadOnFocus(reload);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const { id } = await api.createSet({ name: 'Нов набор', questions: [] });
      openSet(id);
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  if (guest)
    return (
      <Screen>
        <Card>
          <T tone="fg2">Свои въпроси за стаите правят играчите с профил: запази своя с име и парола.</T>
          <Button title="Запази профила" variant="secondary" onPress={() => router.push('/settings')} />
        </Card>
      </Screen>
    );
  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      <T tone="fg2">
        Твои въпроси за частните ти стаи — урок, рожден ден, офис. До {SETS.maxQuestions} в набор: с избор от четири,
        вярно или невярно, число или „Подреди“ — по желание със снимка.
      </T>
      {!data && error ? (
        <LoadError title="Наборите не се заредиха" error={error} onRetry={reload} />
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <>
          <Button
            title="+ Нов набор"
            loading={busy}
            disabled={data.sets.length >= SETS.perOwner}
            onPress={() => void create()}
          />
          {data.sets.length ? (
            data.sets.map((s) => (
              <View
                key={s.id}
                style={{
                  gap: 10,
                  padding: 14,
                  borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.glass,
                }}
              >
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${s.name}: ${s.questions} ${s.questions === 1 ? 'въпрос' : 'въпроса'}${s.hidden ? ', скрит от модератор' : ''}`}
                  onPress={() => openSet(s.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <T style={{ fontSize: 28, lineHeight: 34 }}>📝</T>
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong" numberOfLines={1}>
                      {s.name}
                    </T>
                    <T variant="small" tone="fg3">
                      {s.questions} {s.questions === 1 ? 'въпрос' : 'въпроса'} · {timeAgo(s.updatedAt)}
                      {s.hidden ? ' · скрит от модератор' : ''}
                    </T>
                  </View>
                  <T tone="fg3">›</T>
                </Pressable>
                {s.questions > 0 && !s.hidden && (
                  <Button
                    title="Пусни в стая"
                    label={`Пусни „${s.name}“ в стая`}
                    variant="secondary"
                    onPress={() => void playInRoom(s.id)}
                  />
                )}
              </View>
            ))
          ) : (
            <Card style={{ alignItems: 'center' }}>
              <T style={{ fontSize: 36, lineHeight: 44 }}>📝</T>
              <T variant="title" align="center">
                Още нямаш набор
              </T>
              <T tone="fg2" align="center">
                Направи си един и го пусни в стая — с „Пусни в стая“ до набора, или в стаята от „Въпроси“.
              </T>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
