import { api, errorMessage, fmt, plural, toast, useStore } from '@almanac/client';
import { GROUPS, type GroupEntry, type GroupInfo } from '@almanac/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReportSheet, reasonsFor } from '@/components/ReportSheet';
import { inviteUrl, NameLength, shareInvite, weekName } from '@/groups/parts';
import { useLoad } from '@/lib/load';
import { fonts, gutter, radius, useColors } from '@/theme';
import { Avatar, Button, Card, Field, LoadError, Screen, T } from '@/ui';

const openProfile = (username: string) => router.push({ pathname: '/profile/[username]', params: { username } });

/**
 * One group (the web's GroupView): this week's board (the best days of everyone's daily, the crown on last week's
 * winner), who hasn't played yet, the invite, past winners — and for its owner, renaming, a new link and removing
 * members; for anyone, leaving it, and a report on its name.
 */
export default function Group() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(id);
  const me = useStore((s) => s.me);
  const { data, error, status, loading, reload, set } = useLoad(() => api.group(groupId), id);
  const [renaming, setRenaming] = useState(false);
  const [reporting, setReporting] = useState(false);
  if (!me) return null;
  if (!data && error)
    return (
      <Screen centered>
        {status === 404 ? (
          <Card style={{ alignItems: 'center' }}>
            <T style={{ fontSize: 36, lineHeight: 44 }}>🫂</T>
            <T variant="title" align="center">
              Няма такава група
            </T>
            <T tone="fg2" align="center">
              Или вече не си в нея. Поискай нов линк за покана.
            </T>
          </Card>
        ) : (
          <LoadError title="Групата не се зареди" error={error} onRetry={reload} />
        )}
      </Screen>
    );
  if (!data)
    return (
      <Screen centered>
        <ActivityIndicator />
      </Screen>
    );
  const g = data;
  const removable = (userId: number) => g.isOwner && userId !== me.id;
  const change = async (call: () => Promise<GroupInfo>, done?: string) => {
    try {
      set(await call());
      if (done) toast({ kind: 'success', title: done });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  };
  const remove = (user: { id: number; username: string }) =>
    Alert.alert(
      'Премахване от групата',
      `Да премахна ли ${user.username} от групата? С линка може да влезе отново — за да не може, направи нов линк.`,
      [
        { text: 'Не', style: 'cancel' },
        {
          text: 'Премахни',
          style: 'destructive',
          onPress: () => void change(() => api.removeFromGroup(groupId, user.id)),
        },
      ],
    );
  const leave = () =>
    Alert.alert(
      'Напускане на групата',
      g.isOwner && g.members > 1
        ? 'Групата остава за другите: ще я поеме този, който е в нея най-отдавна.'
        : g.members > 1
          ? 'Можеш да влезеш отново с линк за покана.'
          : 'В групата си само ти: тя ще изчезне заедно с класациите си.',
      [
        { text: 'Не', style: 'cancel' },
        {
          text: 'Напусни',
          style: 'destructive',
          onPress: () =>
            void api.leaveGroup(groupId).then(
              () => router.replace('/groups'),
              (err: unknown) => toast({ kind: 'error', title: errorMessage(err) }),
            ),
        },
      ],
    );
  const destroy = () =>
    Alert.alert(
      'Изтриване на групата',
      `Групата „${g.name}“ и класациите ѝ ще изчезнат за всички ${plural(g.members, 'член', 'членове')}.`,
      [
        { text: 'Не', style: 'cancel' },
        {
          text: 'Изтрий',
          style: 'destructive',
          onPress: () =>
            void api.deleteGroup(groupId).then(
              () => router.replace('/groups'),
              (err: unknown) => toast({ kind: 'error', title: errorMessage(err) }),
            ),
        },
      ],
    );

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: g.name }} />
      <View style={{ gap: 4 }}>
        <T variant="h1" role="heading">
          {g.name}
        </T>
        <T tone="fg2">
          {plural(g.members, 'член', 'членове')}
          {g.owner ? ` · създадена от ${g.owner.username}` : ''}
        </T>
        {g.isOwner && (
          <Button
            title="✎ Преименувай"
            variant="ghost"
            onPress={() => setRenaming(true)}
            style={{ alignSelf: 'flex-start' }}
          />
        )}
      </View>

      {!me.daily.played && (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/daily')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: '#fcd34d44',
            backgroundColor: pressed ? '#fbbf2426' : '#fbbf241a',
          })}
        >
          <T style={{ fontSize: 22, lineHeight: 28 }}>📅</T>
          <T variant="small" style={{ flex: 1 }}>
            <T variant="small" style={{ fontFamily: fonts.bold }}>
              Днешните въпроси
            </T>{' '}
            те чакат — всеки ден е шанс за точки в групата.
          </T>
          <T tone="fg3">›</T>
        </Pressable>
      )}

      <View style={{ gap: 4 }}>
        <T variant="h2" role="heading">
          Тази седмица
        </T>
        <T variant="small" tone="fg3">
          {weekName(g.week.start)}
        </T>
      </View>
      {g.week.entries.length ? (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {g.week.entries.map((e, i) => (
            <BoardRow
              key={e.user.id}
              entry={e}
              you={e.user.id === me.id}
              first={i === 0}
              onRemove={removable(e.user.id) ? () => remove(e.user) : null}
            />
          ))}
        </Card>
      ) : (
        <Card style={{ alignItems: 'center' }}>
          <T style={{ fontSize: 30, lineHeight: 38 }}>📅</T>
          <T variant="title" align="center">
            Седмицата тепърва започва
          </T>
          <T tone="fg2" align="center">
            Който изиграе въпросите на деня, влиза в класацията.
          </T>
        </Card>
      )}
      <T variant="caption" tone="fg3">
        Сбор от най-добрите {GROUPS.bestDays} дни на всеки до неделя вечер. Победителят носи 👑 цялата следваща седмица.
      </T>

      {g.week.waiting.length > 0 && (
        <>
          <T variant="h2" role="heading">
            Още не са играли
          </T>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {g.week.waiting.map((u, i) => (
              <Person key={u.id} user={u} first={i === 0} onRemove={removable(u.id) ? () => remove(u) : null} />
            ))}
          </Card>
        </>
      )}

      <Card>
        <T variant="h2" role="heading">
          Покани
        </T>
        <T variant="small" tone="fg2">
          Който отвори линка, влиза в групата — с профил или като гост.
        </T>
        <T variant="small" tone="fg3" numberOfLines={1} selectable>
          {inviteUrl(g.code)}
        </T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Прати линка" onPress={() => shareInvite(g)} style={{ flex: 1 }} />
          {g.isOwner && (
            <Button
              title="Нов линк"
              variant="ghost"
              hint="Старият линк спира да работи"
              onPress={() =>
                void change(() => api.newGroupLink(groupId), 'Новият линк е готов — старият вече не работи.')
              }
            />
          )}
        </View>
      </Card>

      {g.history.length > 0 && (
        <>
          <T variant="h2" role="heading">
            Победители
          </T>
          <Card style={{ gap: 8 }}>
            {g.history.map((h) => (
              <View
                key={h.week}
                style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}
              >
                <T variant="small" tone="fg3">
                  {weekName(h.week)}
                </T>
                <T variant="small" style={{ fontFamily: fonts.semibold }}>
                  {h.winner ? `👑 ${h.winner.username} · ${fmt(h.score)} т.` : 'никой не игра'}
                </T>
              </View>
            ))}
          </Card>
        </>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button title="Напусни групата" variant="ghost" onPress={leave} />
        {g.isOwner ? (
          <Button title="Изтрий групата" variant="ghost" onPress={destroy} />
        ) : (
          <Button title="🚩 Сигнал за името" variant="ghost" onPress={() => setReporting(true)} />
        )}
      </View>

      <ReportSheet
        open={reporting}
        onClose={() => setReporting(false)}
        title="Сигнал за групата"
        reasons={reasonsFor('group')}
        send={(reason, details) => api.reportGroup(groupId, reason, details)}
      />
      <RenameSheet
        open={renaming}
        name={g.name}
        onClose={() => setRenaming(false)}
        onSave={async (name) => {
          await change(() => api.renameGroup(groupId, name));
          setRenaming(false);
        }}
      />
    </Screen>
  );
}

function BoardRow({
  entry: e,
  you,
  first,
  onRemove,
}: {
  entry: GroupEntry;
  you: boolean;
  first: boolean;
  onRemove: (() => void) | null;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 4,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.line,
        borderRadius: radius.sm,
        backgroundColor: you ? `${colors.violet}18` : undefined,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${e.rank}. ${e.crown ? 'миналата седмица победител, ' : ''}${e.user.username}${you ? ' (ти)' : ''}: ${fmt(e.score)} т., ${plural(e.days, 'ден', 'дни')}${e.today !== null ? ', днес изигран' : ''}`}
        accessibilityHint="Отваря профила"
        onPress={() => openProfile(e.user.username)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <T variant="bodyStrong" tone="fg2" style={{ width: 24, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
          {e.rank}
        </T>
        <Avatar avatar={e.user.avatar} frame={e.user.frame} size={34} />
        <T variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {e.crown ? '👑 ' : ''}
          {e.user.username}
        </T>
        <View style={{ alignItems: 'flex-end' }}>
          <T variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt(e.score)}
          </T>
          <T variant="caption" tone="fg3">
            {plural(e.days, 'ден', 'дни')}
            {e.today !== null ? ' · днес ✓' : ''}
          </T>
        </View>
      </Pressable>
      {onRemove && <RemoveButton name={e.user.username} onPress={onRemove} />}
    </View>
  );
}

function Person({
  user,
  first,
  onRemove,
}: {
  user: { id: number; username: string; avatar: string; frame: string };
  first: boolean;
  onRemove: (() => void) | null;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.line,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={user.username}
        accessibilityHint="Отваря профила"
        onPress={() => openProfile(user.username)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <Avatar avatar={user.avatar} frame={user.frame} size={34} />
        <T variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {user.username}
        </T>
      </Pressable>
      {onRemove && <RemoveButton name={user.username} onPress={onRemove} />}
    </View>
  );
}

function RemoveButton({ name, onPress }: { name: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Премахни ${name} от групата`}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? `${colors.bad}26` : 'transparent',
      })}
    >
      <T tone="fg3">✕</T>
    </Pressable>
  );
}

/** A new name for the group (its owner's), the length said when it's short. */
function RenameSheet({
  open,
  name,
  onClose,
  onSave,
}: {
  open: boolean;
  name: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const save = async () => {
    if (value.trim().length < GROUPS.name[0]) return setTooShort(true);
    setBusy(true);
    await onSave(value);
    setBusy(false);
  };
  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={() => setValue(name)}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: colors.ink }}
        contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + 24, gap: 12 }}
      >
        <T variant="h1" role="heading">
          Ново име
        </T>
        <Field
          label="Име на групата"
          value={value}
          onChangeText={(t) => {
            setValue(t);
            setTooShort(false);
          }}
          maxLength={GROUPS.name[1]}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
        <NameLength tooShort={tooShort} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Отказ" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Запази" loading={busy} onPress={() => void save()} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </Modal>
  );
}
