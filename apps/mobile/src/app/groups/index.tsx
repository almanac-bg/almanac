import { api, errorMessage, toast, useStore } from '@almanac/client';
import { GROUPS } from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GroupRow, NameLength } from '@/groups/parts';
import { useLoad } from '@/lib/load';
import { Button, Card, Field, LoadError, Screen, T } from '@/ui';

/** Групи (the web's GroupList): yours, each with where you stand this week, and a new one made by its name. */
export default function Groups() {
  const me = useStore((s) => s.me);
  const { data, error, loading, reload } = useLoad(() => api.groups());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  if (!me) return null;
  const create = async () => {
    if (name.trim().length < GROUPS.name[0]) return setTooShort(true);
    setBusy(true);
    try {
      const { id } = await api.createGroup(name);
      setName('');
      router.push({ pathname: '/groups/[id]', params: { id: String(id) } });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const full = (data?.groups.length ?? 0) >= GROUPS.perPlayer;
  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      <T tone="fg2">
        Клас, офис, семейство: група с линк за покана и седмична класация на въпросите на деня — сборът от най-добрите
        ти {GROUPS.bestDays} дни от понеделник до неделя. Победителят носи 👑 цялата следваща седмица.
      </T>
      {!data && error ? (
        <LoadError title="Групите не се заредиха" error={error} onRetry={reload} />
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <>
          {data.groups.length > 0 ? (
            <View style={{ gap: 8 }}>
              {data.groups.map((g) => (
                <GroupRow key={g.id} group={g} />
              ))}
            </View>
          ) : (
            <Card style={{ alignItems: 'center' }}>
              <T style={{ fontSize: 36, lineHeight: 44 }}>🫂</T>
              <T variant="title" align="center">
                Още не си в група
              </T>
              <T tone="fg2" align="center">
                Създай една и прати линка — или отвори линк, който са ти пратили.
              </T>
            </Card>
          )}
          {me.isGuest ? (
            <Card>
              <T variant="small" tone="fg2">
                Група се създава с профил: запази своя с име и парола (в чужда група можеш да влезеш и като гост).
              </T>
              <Button title="Запази профила" variant="secondary" onPress={() => router.push('/settings')} />
            </Card>
          ) : full ? (
            <T variant="small" tone="fg3">
              Можеш да си в най-много {GROUPS.perPlayer} групи.
            </T>
          ) : (
            <Card>
              <T variant="h2" role="heading">
                Нова група
              </T>
              <Field
                label="Име на групата"
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setTooShort(false);
                }}
                maxLength={GROUPS.name[1]}
                placeholder="Например „10 Б клас“ или „Офис 3“"
                returnKeyType="done"
                onSubmitEditing={() => void create()}
              />
              <NameLength tooShort={tooShort} />
              <Button title="Създай" loading={busy} onPress={() => void create()} />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
