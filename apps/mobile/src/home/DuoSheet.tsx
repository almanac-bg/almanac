import { actions, api, PRESENCE, useStore } from '@almanac/client';
import { avatarEmoji, type FriendEntry } from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLoad } from '@/lib/load';
import { fonts, gutter, useColors } from '@/theme';
import { Button, T } from '@/ui';

/** A friend who could say yes now: online, in a room or in a queue (not mid-match or away). */
const available = (f: FriendEntry) => f.presence === 'online' || f.presence === 'room' || f.presence === 'queue';

/**
 * What Отбори needs, for its tile on Играй — said before the tap rather than after it: a profile, a friend, and one of
 * them online now. `ready`: someone could play now.
 */
export function useDuoNeed(open: boolean): { text: string; ready: boolean } {
  const guest = useStore((s) => !!s.me?.isGuest);
  const version = useStore((s) => s.friendsVersion);
  const asks = open && !guest;
  const { data } = useLoad(() => (asks ? api.friends() : Promise.resolve(null)), `${asks}:${version}`);
  if (guest) return { text: 'Нужни са профил и приятел', ready: false };
  if (!data) return { text: 'Играе се с приятел', ready: true };
  if (!data.friends.length) return { text: 'Нужен е приятел', ready: false };
  const online = data.friends.filter(available).length;
  return online
    ? { text: `С приятел · ${online} онлайн`, ready: true }
    : { text: 'С приятел · никой не е онлайн', ready: false };
}

/**
 * Отбори is two friends together (the web's DuoPicker): who to ask. Once they say yes, the two of you wait in the queue
 * as a pair, against another pair of people or bots.
 */
export function DuoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const guest = useStore((s) => !!s.me?.isGuest);
  const version = useStore((s) => s.friendsVersion);
  const { data } = useLoad(() => (open && !guest ? api.friends() : Promise.resolve(null)), `${open}:${version}`);
  const [asked, setAsked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const friends = [...(data?.friends ?? [])].sort((a, b) => Number(available(b)) - Number(available(a)));

  const ask = async (f: FriendEntry) => {
    setBusy(f.user.id);
    setError(null);
    const res = await actions.inviteDuo(f.user.id);
    setBusy(null);
    if (res.ok) setAsked((s) => new Set(s).add(f.user.id));
    else setError(res.error);
  };
  const go = (path: '/friends' | '/settings') => {
    onClose();
    router.navigate(path);
  };

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.ink }}
        contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + 24, gap: 14 }}
      >
        <T variant="h1" role="heading">
          Отбори: с кого играеш?
        </T>
        <T tone="fg2">
          Двама приятели в един отбор срещу друга двойка (хора или ботове). Покани някого — щом приеме, търсим
          съперници.
        </T>
        {guest ? (
          <>
            <T tone="fg2">Приятелите са за профили: запази своя с име и парола, за да играеш Отбори.</T>
            <Button title="Запази профила" onPress={() => go('/settings')} />
          </>
        ) : !data ? (
          <ActivityIndicator style={{ marginVertical: 24 }} />
        ) : friends.length === 0 ? (
          <>
            <T tone="fg3">Още нямаш приятели тук. Добави някого — и играйте заедно.</T>
            <Button title="Към приятелите" variant="secondary" onPress={() => go('/friends')} />
          </>
        ) : (
          <View>
            {friends.map((f, i) => {
              const free = available(f);
              const sent = asked.has(f.user.id);
              const p = PRESENCE[f.presence];
              return (
                <View
                  key={f.user.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 10,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.line,
                  }}
                >
                  <T style={{ fontSize: 28, lineHeight: 34 }}>{avatarEmoji(f.user.avatar)}</T>
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong" numberOfLines={1}>
                      {f.user.username}
                    </T>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
                      <T variant="caption" tone="fg3">
                        {p.label}
                      </T>
                    </View>
                  </View>
                  {sent ? (
                    <T variant="small" tone="good" style={{ fontFamily: fonts.semibold }}>
                      ✓ Поканата е пратена
                    </T>
                  ) : (
                    <Button
                      title="Покани"
                      label={`Покани ${f.user.username}`}
                      variant={free ? 'primary' : 'ghost'}
                      disabled={!free}
                      loading={busy === f.user.id}
                      onPress={() => void ask(f)}
                    />
                  )}
                </View>
              );
            })}
          </View>
        )}
        {error ? (
          <T variant="small" tone="bad" role="alert">
            {error}
          </T>
        ) : null}
        {asked.size > 0 && (
          <T tone="fg2" accessibilityLiveRegion="polite">
            Поканата важи минута. Щом приеме, търсенето започва само.
          </T>
        )}
        <Button title="Затвори" variant="ghost" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
