import { actions, toast, useStore } from '@almanac/client';
import { ROOM_CODE_DIGITS } from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { DuelList, useDuels } from '@/duels/parts';
import { fonts, radius, useColors } from '@/theme';
import { Button, Card, T } from '@/ui';

/**
 * „С приятели“ (the web's FriendsCard): the friend duels still open, and Частна стая — one of your own, or a friend's
 * or a teacher's by its code. A guest can join one but not open one: the button still shows, and says why.
 */
export function RoomsCard() {
  const colors = useColors();
  const guest = useStore((s) => !!s.me?.isGuest);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Friend duels still open: yours to play first, then the ones waiting for the friend.
  const { data } = useDuels();
  const open = (data?.duels ?? [])
    .filter((d) => d.state === 'yours' || d.state === 'theirs')
    .sort((a, b) => Number(b.state === 'yours') - Number(a.state === 'yours'))
    .slice(0, 3);
  const create = async () => {
    setBusy(true);
    const res = await actions.createRoom();
    setBusy(false);
    if (res.ok) router.push('/room');
    else toast({ kind: 'error', title: res.error });
  };
  const join = () => {
    if (code.length === ROOM_CODE_DIGITS) router.push({ pathname: '/join/[code]', params: { code } });
  };
  return (
    <Card accent="#e879f9">
      <T variant="label" style={{ color: '#f0abfc' }}>
        С приятели
      </T>
      <T variant="h2" role="heading">
        Частна стая
      </T>
      <T variant="small" tone="fg3">
        {guest
          ? 'До 40 играчи. Имаш код от приятел или от учителя? Въведи го и влизаш в стаята.'
          : 'До 40 играчи, твои правила. Сподели кода и започвай.'}
      </T>
      {open.length > 0 && (
        <View>
          <T variant="label" tone="fg3">
            Дуели
          </T>
          <DuelList duels={open} />
        </View>
      )}
      {guest ? (
        <Button
          title="🔒 Създай своя стая"
          variant="secondary"
          onPress={() => router.push('/settings')}
          hint="Свои стаи създават играчите с профил: запази своя в Настройки"
        />
      ) : (
        <Button title="+ Създай стая" variant="secondary" loading={busy} onPress={() => void create()} />
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, ROOM_CODE_DIGITS))}
          keyboardType="number-pad"
          returnKeyType="go"
          onSubmitEditing={join}
          accessibilityLabel="Код на стая"
          placeholder="Код на стая"
          placeholderTextColor={colors.fg3}
          style={{
            flex: 1,
            minHeight: 48,
            paddingHorizontal: 14,
            borderRadius: radius.md,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: colors.lineStrong,
            backgroundColor: colors.ink2,
            color: colors.fg,
            fontFamily: code ? fonts.bold : fonts.regular,
            fontSize: code ? 20 : 16,
            letterSpacing: code ? 6 : 0,
          }}
        />
        <Button
          title="Влез"
          label="Влез в стаята"
          variant="secondary"
          disabled={code.length !== ROOM_CODE_DIGITS}
          onPress={join}
        />
      </View>
    </Card>
  );
}

/** You're in a room (back on Играй, the seat kept): the way back to it. */
export function RoomBanner() {
  const colors = useColors();
  const code = useStore((s) => s.room?.code);
  if (!code) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Ти си в стая ${code}. Към стаята`}
      onPress={() => router.push('/room')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 14,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: '#e879f955',
        backgroundColor: pressed ? colors.lineStrong : colors.glass,
      })}
    >
      <T>🚪</T>
      <T variant="small" style={{ flex: 1 }}>
        Ти си в стая{' '}
        <T variant="small" style={{ fontFamily: fonts.bold, letterSpacing: 2 }}>
          {code}
        </T>
      </T>
      <T variant="small" tone="link" style={{ fontFamily: fonts.semibold }}>
        Към стаята →
      </T>
    </Pressable>
  );
}
