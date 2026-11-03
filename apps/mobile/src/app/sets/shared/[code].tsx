import { api, errorMessage, setKinds, toast, useStore } from '@almanac/client';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { ReportSheet, reasonsFor } from '@/components/ReportSheet';
import { useLoad } from '@/lib/load';
import { Button, Card, LoadError, Screen, T } from '@/ui';

const openSet = (id: number) => router.replace({ pathname: '/sets/[id]', params: { id: String(id) } });

/**
 * Another host's set by its link, /sets/shared/<code> (the web's SharedSet): what's in it, a copy of it for your own
 * rooms (an account's), or your own set opened — and a report.
 */
export default function SharedSet() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const guest = useStore((s) => !!s.me?.isGuest);
  const { data, error, status, reload } = useLoad(() => api.sharedSet(code), code);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const copy = async () => {
    setBusy(true);
    try {
      const { id } = await api.copySet(code);
      toast({ kind: 'success', title: 'Копието е твое', body: 'Пусни го в стая с „Пусни в стая“ до набора.' });
      openSet(id);
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
      setBusy(false);
    }
  };
  if (!data && error)
    return (
      <Screen centered>
        {status === 404 ? (
          <Card style={{ alignItems: 'center' }}>
            <T style={{ fontSize: 36, lineHeight: 44 }}>🔗</T>
            <T variant="title" align="center">
              Този набор вече не е достъпен
            </T>
          </Card>
        ) : (
          <LoadError title="Наборът не се зареди" error={error} onRetry={reload} />
        )}
      </Screen>
    );
  if (!data)
    return (
      <Screen centered>
        <ActivityIndicator />
      </Screen>
    );
  const kinds = setKinds(data.kinds);
  return (
    <Screen centered>
      <Card style={{ alignItems: 'center', gap: 10 }}>
        <T style={{ fontSize: 44, lineHeight: 52 }}>📝</T>
        <T variant="label" tone="fg3">
          Набор с въпроси
        </T>
        <T variant="h1" role="heading" align="center">
          {data.name}
        </T>
        <T tone="fg2" align="center">
          {data.questions} {data.questions === 1 ? 'въпрос' : 'въпроса'}
          {data.author ? ` · от ${data.author}` : ''}
        </T>
        {kinds ? (
          <T variant="small" tone="fg3" align="center">
            {kinds}
          </T>
        ) : null}
        {data.hidden && (
          <T variant="small" tone="bad">
            Скрит от модератор.
          </T>
        )}
        {data.mine ? (
          <Button
            title="Отвори своя набор"
            size="lg"
            onPress={() => openSet(data.mine!)}
            style={{ alignSelf: 'stretch' }}
          />
        ) : guest ? (
          <>
            <T variant="small" tone="fg2" align="center">
              Копие за своите стаи взимат играчите с профил: запази своя с име и парола.
            </T>
            <Button title="Запази профила" variant="secondary" onPress={() => router.push('/settings')} />
          </>
        ) : (
          <Button
            title="Вземи копие за моите стаи"
            size="lg"
            loading={busy}
            disabled={data.hidden}
            onPress={() => void copy()}
            style={{ alignSelf: 'stretch' }}
          />
        )}
      </Card>
      {!data.mine && <Button title="🚩 Сигнализирай" variant="ghost" onPress={() => setReporting(true)} />}
      <ReportSheet
        open={reporting}
        onClose={() => setReporting(false)}
        title={`Сигнал за набора „${data.name}“`}
        reasons={reasonsFor('set')}
        send={(reason, details) => api.reportSet(code, reason, details)}
      />
    </Screen>
  );
}
