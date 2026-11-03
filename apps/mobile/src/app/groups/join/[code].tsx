import { api, errorMessage, plural, toast, useStore } from '@almanac/client';
import { GROUPS } from '@almanac/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { ReportSheet, reasonsFor } from '@/components/ReportSheet';
import { useLoad } from '@/lib/load';
import { Button, Card, LoadError, Screen, T } from '@/ui';

const toGroup = (id: number) => router.replace({ pathname: '/groups/[id]', params: { id: String(id) } });

/** A group's invite link, /groups/join/<code> (the web's GroupInvite): what it is, and „Влез в групата“. */
export default function GroupInvite() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const guest = useStore((s) => !!s.me?.isGuest);
  const { data, error, status, reload } = useLoad(() => api.groupPreview(code), code);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Already in it: straight to the group.
  useEffect(() => {
    if (data?.memberOf) toGroup(data.memberOf);
  }, [data]);
  const join = async () => {
    setBusy(true);
    try {
      const { id } = await api.joinGroup(code);
      toast({ kind: 'success', title: `Влезе в „${data?.name ?? 'групата'}“` });
      toGroup(id);
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
              Линкът вече не е валиден
            </T>
            <T tone="fg2" align="center">
              Поискай нов линк от този, който те покани.
            </T>
          </Card>
        ) : (
          <LoadError title="Поканата не се зареди" error={error} onRetry={reload} />
        )}
      </Screen>
    );
  if (!data || data.memberOf)
    return (
      <Screen centered>
        <ActivityIndicator />
      </Screen>
    );
  return (
    <Screen centered>
      <Card style={{ alignItems: 'center', gap: 10 }}>
        <T style={{ fontSize: 44, lineHeight: 52 }}>🫂</T>
        <T variant="label" tone="fg3">
          Покана за група
        </T>
        <T variant="h1" role="heading" align="center">
          {data.name}
        </T>
        <T tone="fg2" align="center">
          {plural(data.members, 'член', 'членове')}
          {data.owner ? ` · създадена от ${data.owner}` : ''}
        </T>
        <T variant="small" tone="fg2" align="center">
          Всяка седмица — класация на въпросите на деня: сборът от най-добрите {GROUPS.bestDays} дни на всеки.
          Победителят носи 👑.
        </T>
        {data.full ? (
          <T variant="small" tone="bad" align="center">
            Групата е пълна ({GROUPS.maxMembers} членове).
          </T>
        ) : (
          <Button
            title="Влез в групата"
            size="lg"
            loading={busy}
            onPress={() => void join()}
            style={{ alignSelf: 'stretch' }}
          />
        )}
      </Card>
      {guest && (
        <T variant="small" tone="fg3" align="center">
          В групата ще се виждаш с името на гост. Запази профила си с име, за да те познаят.
        </T>
      )}
      <Button title="🚩 Сигнал за името на групата" variant="ghost" onPress={() => setReporting(true)} />
      <ReportSheet
        open={reporting}
        onClose={() => setReporting(false)}
        title="Сигнал за групата"
        reasons={reasonsFor('group')}
        send={(reason, details) => api.reportGroupInvite(code, reason, details)}
      />
    </Screen>
  );
}
