import { actions, toast, useStore } from '@almanac/client';
import { BRAND } from '@almanac/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '@/lib/client';
import { Door, InviteFriends, Players } from '@/room/parts';
import { RoomSettings } from '@/room/RoomSettings';
import { fonts, gutter, useColors } from '@/theme';
import { Button, Card, COLUMN, T, usePagePadding } from '@/ui';

/**
 * A private room's lobby (the web's RoomPage): its code to share, who's in (in teams, with the host's buttons), the
 * door, friends to invite, the settings, and the start — kept at the bottom, in view however long the settings run.
 * Back from here keeps the seat; „Напусни стаята“ gives it up.
 */
export default function Room() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const padding = usePagePadding();
  const room = useStore((s) => s.room);
  // After a blip the server sends the room again within moments (it kept the seat): no trip to Играй meanwhile.
  const settled = useStore((s) => s.settled);
  const me = useStore((s) => s.me);
  const [starting, setStarting] = useState(false);

  if (!me) return null;
  if (!room) return settled ? <Redirect href="/" /> : <ActivityIndicator style={{ marginTop: 80 }} />;

  const isHost = room.hostId === `u${me.id}`;
  const s = room.settings;
  const hasBots = room.players.some((p) => p.isBot);
  const teamsReady = !s.teams || new Set(room.players.map((p) => p.team)).size === 2;
  // „Само водя“ (set on the site): the players are everyone but the host.
  const playing = s.hostPlays ? room.players : room.players.filter((p) => !p.isHost);
  const canStart = (s.hostPlays ? playing.length >= 2 : playing.some((p) => !p.isBot)) && teamsReady;
  const startHint =
    !s.hostPlays && !playing.some((p) => !p.isBot)
      ? 'Прати кода на играчите — играта започва, щом влезе поне един.'
      : s.hostPlays && playing.length < 2
        ? 'Покани приятел или добави бот, за да започнеш.'
        : !teamsReady
          ? 'И двата отбора трябва да имат поне по един играч.'
          : null;
  const link = `${API_URL}/join/${room.code}`;

  const share = () => void Share.share({ message: `Ела да играем в ${BRAND.name}! Стая ${room.code}\n${link}` });
  const start = async () => {
    setStarting(true);
    const res = await actions.startRoom();
    setStarting(false);
    // Started, the match screen opens by itself.
    if (!res.ok) toast({ kind: 'error', title: res.error });
  };
  const leave = () => {
    actions.leaveRoom();
    router.replace('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[padding, { paddingBottom: 24 }]}>
        <View style={[COLUMN, { gap: 16 }]}>
          <Card>
            <T variant="label" style={{ color: '#f0abfc' }}>
              Код на стаята
            </T>
            <T
              accessibilityLabel={`Код ${room.code.split('').join(' ')}`}
              style={{ fontFamily: fonts.displayHeavy, fontSize: 44, lineHeight: 52, letterSpacing: 8 }}
              selectable
            >
              {room.code}
            </T>
            <T variant="small" tone="fg2">
              На телефона: {BRAND.domain} → „Имам код за стая“ → {room.code}
            </T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Покани" variant="secondary" onPress={share} style={{ flex: 1 }} />
              <Button title="Напусни стаята" variant="ghost" onPress={leave} style={{ flex: 1 }} />
            </View>
          </Card>

          <Card>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <T variant="h2" role="heading">
                Играчи{' '}
                <T variant="h2" tone="fg3">
                  {room.players.length}/{s.maxPlayers}
                </T>
              </T>
              {isHost && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button
                    title="🤖 Добави бот"
                    variant="secondary"
                    disabled={room.players.length >= s.maxPlayers}
                    onPress={() => actions.roomBot('add')}
                  />
                  {hasBots && (
                    <Button title="−" label="Махни бот" variant="ghost" onPress={() => actions.roomBot('remove')} />
                  )}
                </View>
              )}
            </View>
            <Players room={room} meId={me.id} isHost={isHost} />
            {isHost ? (
              <Door room={room} />
            ) : (
              room.locked && (
                <T variant="small" tone="fg3">
                  🔒 Стаята е заключена: нови играчи влизат само с разрешение на домакина.
                </T>
              )
            )}
          </Card>

          {/* Guests have no friends list (the code works for everyone). */}
          {!me.isGuest && <InviteFriends room={room} />}
          <RoomSettings room={room} isHost={isHost} />
        </View>
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          paddingLeft: insets.left + gutter,
          paddingRight: insets.right + gutter,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          backgroundColor: colors.ink2,
        }}
      >
        <View style={{ flex: 1 }} accessibilityLiveRegion="polite">
          <T variant="bodyStrong">
            Играчи {room.players.length}/{s.maxPlayers}
          </T>
          <T variant="caption" tone="fg3">
            {isHost ? (startHint ?? 'Всичко е готово за старт.') : 'Чакаме домакина да започне…'}
          </T>
        </View>
        {isHost && (
          <Button title="▶ Започни" size="lg" loading={starting} disabled={!canStart} onPress={() => void start()} />
        )}
      </View>
    </View>
  );
}
