import { api, errorMessage, PRESENCE, sortDuels, timeAgo, useStore } from '@almanac/client';
import { avatarEmoji, BRAND, type FriendEntry, type FriendsResponse } from '@almanac/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, View } from 'react-native';
import { DuelButton } from '@/components/DuelButton';
import { DuelList, useDuels } from '@/duels/parts';
import { GroupsSection } from '@/groups/parts';
import { API_URL } from '@/lib/client';
import { useLoad } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { Button, Field, LoadError, Screen, T } from '@/ui';
import { Section } from '@/ui/controls';

/** Приятели: add by name, the requests, the list with where each friend is, and a Дуел with any of them. */
export default function Friends() {
  const me = useStore((s) => s.me);
  // The server bumps the version whenever the list changes (a request, a friend online): it loads again.
  const version = useStore((s) => s.friendsVersion);
  const guest = !me || me.isGuest;
  const { data, error, loading, reload } = useLoad(
    () => (guest ? Promise.resolve(null) : api.friends()),
    `${guest}:${version}`,
  );
  // What a change answered with (an accept, an add), until the next load brings the list as the server has it.
  const [shown, setShown] = useState<FriendsResponse | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new load (`data`) is the trigger, not an input
  useEffect(() => setShown(null), [data]);
  const list = shown ?? data;
  const mutate = async (fn: () => Promise<FriendsResponse>, success?: string) => {
    try {
      setShown(await fn());
      if (success) Alert.alert(success);
    } catch (err) {
      Alert.alert('Не стана', errorMessage(err));
    }
  };
  if (!me) return null;
  if (guest)
    return (
      <Screen centered>
        <T variant="h1" role="heading" align="center">
          Приятели
        </T>
        <T tone="fg2" align="center">
          Приятелите са за играчи с профил: запази своя с име и парола, за да добавяш хора, да виждаш кой е онлайн и да
          се предизвиквате на дуел.
        </T>
        <Button title="Запази профила" onPress={() => router.push('/settings')} />
      </Screen>
    );
  return (
    <Screen refreshing={loading && !!list} onRefresh={reload}>
      <T variant="h1" role="heading">
        Приятели
      </T>
      <AddFriend onAdded={(next) => setShown(next)} />
      <Duels />
      <GroupsSection />
      {error && !list ? (
        <LoadError title="Приятелите не се заредиха" error={error} onRetry={reload} />
      ) : !list ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <>
          {list.incoming.length > 0 && (
            <Section title="Покани за теб">
              {list.incoming.map((f) => (
                <View key={f.user.id} style={{ gap: 8 }}>
                  <Person entry={f} hint={`покана ${timeAgo(f.since)}`} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                      title="Приеми"
                      onPress={() => void mutate(() => api.acceptFriend(f.user.id), 'Вече сте приятели!')}
                      style={{ flex: 1 }}
                    />
                    <Button title="Откажи" variant="ghost" onPress={() => decline(f, mutate)} style={{ flex: 1 }} />
                  </View>
                </View>
              ))}
            </Section>
          )}
          <Section title="Списък">
            {list.friends.length === 0 ? (
              <>
                <T tone="fg2">
                  Още нямаш приятели тук. Добави някого по потребителско име горе — или прати своето: щом се приемете,
                  ще виждате кой е онлайн и ще се предизвиквате на дуел.
                </T>
                <InviteFriend />
              </>
            ) : (
              list.friends.map((f) => (
                <FriendRow
                  key={f.user.id}
                  entry={f}
                  onRemove={() =>
                    Alert.alert('Да премахнеш ли приятел?', `${f.user.username} вече няма да е в списъка ти.`, [
                      { text: 'Отказ', style: 'cancel' },
                      {
                        text: 'Премахни',
                        style: 'destructive',
                        onPress: () => void mutate(() => api.removeFriend(f.user.id)),
                      },
                    ])
                  }
                />
              ))
            )}
          </Section>
          {list.outgoing.length > 0 && (
            <Section title="Изпратени покани">
              {list.outgoing.map((f) => (
                <View key={f.user.id} style={{ gap: 8 }}>
                  <Person entry={f} hint={`изпратена ${timeAgo(f.since)}`} />
                  <Button
                    title="Оттегли поканата"
                    variant="ghost"
                    onPress={() => void mutate(() => api.removeFriend(f.user.id))}
                  />
                </View>
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

/** Declining a request asks once more: just no, or no and never again (blocked: no more requests either way). */
function decline(f: FriendEntry, mutate: (fn: () => Promise<FriendsResponse>) => Promise<void>) {
  Alert.alert('Покана за приятелство', `Да откажеш ли на ${f.user.username}?`, [
    { text: 'Остави я', style: 'cancel' },
    { text: 'Откажи', onPress: () => void mutate(() => api.removeFriend(f.user.id)) },
    {
      text: 'Откажи и блокирай',
      style: 'destructive',
      onPress: () =>
        void mutate(async () => {
          await api.block(f.user.id);
          return api.friends();
        }),
    },
  ]);
}

function AddFriend({ onAdded }: { onAdded: (next: FriendsResponse) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const add = async () => {
    setBusy(true);
    setNote(null);
    try {
      onAdded(await api.addFriend(name.trim()));
      setNote({ ok: true, text: `Поканата до ${name.trim()} е изпратена.` });
      setName('');
    } catch (err) {
      setNote({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Field
        label="Добави приятел по потребителско име"
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={() => name.trim() && void add()}
      />
      {note ? (
        <T variant="small" tone={note.ok ? 'good' : 'bad'} accessibilityLiveRegion="polite">
          {note.text}
        </T>
      ) : null}
      <Button
        title="Изпрати покана"
        variant="secondary"
        loading={busy}
        disabled={!name.trim()}
        onPress={() => void add()}
      />
    </View>
  );
}

/** Who a row is about: their avatar, name and a line about them. */
function Person({ entry, hint }: { entry: FriendEntry; hint: string }) {
  const colors = useColors();
  const p = PRESENCE[entry.presence];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.user.username}, ${hint}`}
      accessibilityHint="Отваря профила"
      onPress={() => router.push({ pathname: '/profile/[username]', params: { username: entry.user.username } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: radius.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View>
        <T style={{ fontSize: 30, lineHeight: 36, opacity: entry.presence === 'offline' ? 0.5 : 1 }}>
          {avatarEmoji(entry.user.avatar)}
        </T>
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: 2,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: p.color,
            borderWidth: 2,
            borderColor: colors.ink,
          }}
        />
      </View>
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" numberOfLines={1}>
          {entry.user.username}
        </T>
        <T variant="small" tone="fg3">
          {hint}
        </T>
      </View>
    </Pressable>
  );
}

function FriendRow({ entry, onRemove }: { entry: FriendEntry; onRemove: () => void }) {
  const colors = useColors();
  return (
    <View
      accessible={false}
      style={{ gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line, borderRadius: radius.sm }}
    >
      <Person entry={entry} hint={PRESENCE[entry.presence].label} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <DuelButton friendId={entry.user.id} style={{ flex: 1 }} />
        <Button title="Премахни" variant="ghost" onPress={onRemove} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/** Your friend duels, when there are any: the ones waiting for you first. */
function Duels() {
  const { data } = useDuels();
  const duels = sortDuels(data?.duels ?? []);
  if (!duels.length) return null;
  return (
    <Section title="Дуели">
      <DuelList duels={duels} />
    </Section>
  );
}

/** Your own name, for a friend to add: sent with the site's address. */
function InviteFriend() {
  const name = useStore((s) => s.me?.username ?? '');
  return (
    <View style={{ gap: 8 }}>
      <T variant="small" tone="fg2">
        Твоето име:{' '}
        <T variant="small" style={{ fontFamily: fonts.bold }}>
          {name}
        </T>
      </T>
      <Button
        title="Прати името си"
        variant="secondary"
        onPress={() =>
          void Share.share({ message: `Добави ме в ${BRAND.name} — името ми е „${name}“. Да се мерим: ${API_URL}` })
        }
      />
    </View>
  );
}
