import { actions, api, PRESENCE, plural, toast, useStore } from '@almanac/client';
import { type RoomPlayer, type RoomState, TEAMS, type TeamId } from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { useLoad } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { Avatar, Button, Card, LoadError, T } from '@/ui';
import { Toggle } from '@/ui/controls';

/**
 * Asks before a person leaves the room (a bot goes with one tap: it comes back as easily). A guest can come back as a
 * new one with another name, unless the room is locked: so the host can lock it in the same step.
 */
export function kickPlayer(room: RoomState, p: RoomPlayer) {
  if (p.isBot) return actions.roomKick(p.id);
  const comesBack = p.isGuest && !room.locked;
  const why = !p.isGuest
    ? 'Ще може да се върне само с нова покана от теб.'
    : room.locked
      ? 'Стаята е заключена: ако почука пак, решаваш ти.'
      : 'Гост може да влезе пак с ново име — заключи стаята и ще влиза само който пуснеш ти.';
  Alert.alert(`Да премахна ли ${p.name} от стаята?`, why, [
    { text: 'Отказ', style: 'cancel' },
    { text: 'Премахни', style: comesBack ? 'default' : 'destructive', onPress: () => actions.roomKick(p.id) },
    ...(comesBack
      ? [
          {
            text: 'Премахни и заключи',
            style: 'destructive' as const,
            onPress: () => {
              actions.roomKick(p.id);
              actions.roomLock(true);
            },
          },
        ]
      : []),
  ]);
}

/** One seat: the avatar (a bot or a guest marked on it), the name, the host's crown, and the host's buttons. */
function PlayerRow({ room, p, meId, isHost }: { room: RoomState; p: RoomPlayer; meId: number; isHost: boolean }) {
  const colors = useColors();
  const mine = p.id === `u${meId}`;
  const kickable = isHost && !p.isHost;
  // A guest's name is what they typed: the host can swap it for a plain „Играч N“ (on a class's screen above all).
  const renamable = isHost && p.isGuest && !p.isHost && !/^Играч \d+$/.test(p.name);
  const other = p.team !== null && p.team !== undefined ? TEAMS[p.team === 0 ? 1 : 0].name : null;
  const tag = p.isBot ? 'БОТ' : p.isGuest ? 'ГОСТ' : null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 10,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: mine ? `${colors.violet}66` : colors.line,
        backgroundColor: mine ? `${colors.violet}18` : colors.glass,
      }}
    >
      <View
        accessible
        accessibilityLabel={`${p.name}${tag ? `, ${tag.toLowerCase()}` : ''}${p.isHost ? ', домакин' : ''}${mine ? ' (ти)' : ''}`}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <View>
          <Avatar avatar={p.avatar} frame={p.frame} size={40} />
          {tag && (
            <View
              style={{
                position: 'absolute',
                bottom: -4,
                alignSelf: 'center',
                paddingHorizontal: 3,
                borderRadius: 4,
                backgroundColor: colors.ink2,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              <T variant="caption" tone="fg2" style={{ fontSize: 10, lineHeight: 13, fontFamily: fonts.bold }}>
                {tag}
              </T>
            </View>
          )}
        </View>
        <T variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {p.name}
        </T>
        {p.isHost && <T>👑</T>}
      </View>
      {isHost && other && (
        <SeatButton label={`Премести ${p.name} при ${other}`} icon="⇄" onPress={() => actions.roomTeam(p.id)} />
      )}
      {renamable && (
        <SeatButton
          label={`Смени името ${p.name} на „Играч“ с номер`}
          icon="✎"
          onPress={() => actions.roomRename(p.id)}
        />
      )}
      {kickable && <SeatButton label={`Премахни ${p.name}`} icon="✕" danger onPress={() => kickPlayer(room, p)} />}
    </View>
  );
}

function SeatButton({
  label,
  icon,
  danger = false,
  onPress,
}: {
  label: string;
  icon: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? (danger ? `${colors.bad}26` : colors.lineStrong) : 'transparent',
      })}
    >
      <T tone={danger ? 'bad' : 'fg3'} style={{ fontFamily: fonts.bold }}>
        {icon}
      </T>
    </Pressable>
  );
}

function FreeSeats({ count }: { count: number }) {
  const colors = useColors();
  return (
    <View
      style={{
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.line,
      }}
    >
      <T variant="small" tone="fg3">
        Още {plural(count, 'свободно място', 'свободни места')}
      </T>
    </View>
  );
}

/** Who's in: one list, or with Отбори the two teams side by side in colour; then the free seats as one tile. */
export function Players({ room, meId, isHost }: { room: RoomState; meId: number; isHost: boolean }) {
  const free = room.settings.maxPlayers - room.players.length;
  if (!room.settings.teams)
    return (
      <View style={{ gap: 8 }}>
        {room.players.map((p) => (
          <PlayerRow key={p.id} room={room} p={p} meId={meId} isHost={isHost} />
        ))}
        {free > 0 && <FreeSeats count={free} />}
      </View>
    );
  return (
    <View style={{ gap: 10 }}>
      {([0, 1] as TeamId[]).map((team) => {
        const { name, color } = TEAMS[team];
        const members = room.players.filter((p) => p.team === team);
        return (
          <View
            key={team}
            style={{
              gap: 8,
              padding: 8,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: `${color}44`,
              backgroundColor: `${color}0d`,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
              <T variant="bodyStrong" style={{ flex: 1 }}>
                {name}
              </T>
              <T variant="caption" tone="fg3">
                {members.length}
              </T>
            </View>
            {members.map((p) => (
              <PlayerRow key={p.id} room={room} p={p} meId={meId} isHost={isHost} />
            ))}
            {members.length === 0 && (
              <T variant="small" tone="fg3" align="center" style={{ paddingVertical: 12 }}>
                Празен отбор
              </T>
            )}
          </View>
        );
      })}
      {free > 0 && <FreeSeats count={free} />}
    </View>
  );
}

/** The host's door: „Заключи стаята“, and who's knocking on it — each let in or not. */
export function Door({ room }: { room: RoomState }) {
  const colors = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const answer = async (playerId: string, admit: boolean) => {
    setBusy(playerId);
    const res = await actions.roomAdmit(playerId, admit);
    setBusy(null);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  };
  return (
    <View style={{ gap: 10 }}>
      <Toggle
        label="🔒 Заключи стаята"
        hint={
          room.locked
            ? 'Който влезе с кода, чука на вратата — ти решаваш дали да влезе'
            : 'Щом всички са вътре: който дойде после, чака разрешение от теб'
        }
        value={room.locked}
        onChange={(locked) => actions.roomLock(locked)}
      />
      {room.knocking.length > 0 && (
        <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
          <T variant="bodyStrong">На вратата: {room.knocking.length}</T>
          {room.knocking.map((k) => (
            <View
              key={k.id}
              style={{
                gap: 8,
                padding: 10,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              <T variant="bodyStrong">
                {k.name}
                {k.isGuest ? '  · ГОСТ' : ''}
              </T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  title="✓ Пусни"
                  label={`Пусни ${k.name}`}
                  loading={busy === k.id}
                  onPress={() => void answer(k.id, true)}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Не"
                  label={`Не пускай ${k.name}`}
                  variant="ghost"
                  disabled={busy === k.id}
                  onPress={() => void answer(k.id, false)}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** The friends online now, each a tap from an invitation into this room. */
export function InviteFriends({ room }: { room: RoomState }) {
  const colors = useColors();
  const version = useStore((s) => s.friendsVersion);
  const { data, error, reload } = useLoad(() => api.friends(), version);
  const [sent, setSent] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState<number | null>(null);
  const invite = async (userId: number) => {
    setSending(userId);
    const res = await actions.invite(userId);
    setSending(null);
    if (!res.ok) return toast({ kind: 'error', title: res.error });
    toast({ kind: 'success', title: 'Поканата е изпратена' });
    setSent((s) => new Set(s).add(userId));
    // An invitation lasts a minute or so: after a while it can be sent again.
    setTimeout(
      () =>
        setSent((s) => {
          const next = new Set(s);
          next.delete(userId);
          return next;
        }),
      15_000,
    );
  };
  const friends = data?.friends ?? null;
  const online = friends?.filter((f) => f.presence !== 'offline') ?? [];
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <T variant="h2" role="heading">
          Покани приятели
        </T>
        <Pressable accessibilityRole="link" onPress={() => router.navigate('/friends')} hitSlop={8}>
          <T variant="small" tone="link" style={{ fontFamily: fonts.semibold }}>
            Приятели →
          </T>
        </Pressable>
      </View>
      {friends === null ? (
        error ? (
          <LoadError title="Приятелите не се заредиха" error={error} onRetry={reload} />
        ) : (
          <ActivityIndicator />
        )
      ) : friends.length === 0 ? (
        <T variant="small" tone="fg3">
          Още нямаш приятели в играта — прати им кода с „Покани“ горе. Добави приятели, за да ги каниш направо оттук.
        </T>
      ) : online.length === 0 ? (
        <T variant="small" tone="fg3">
          Никой от приятелите ти не е онлайн в момента. Прати им кода с „Покани“ горе.
        </T>
      ) : (
        online.map((f, i) => {
          const inRoom = room.players.some((p) => p.id === `u${f.user.id}`);
          const wasSent = sent.has(f.user.id);
          const p = PRESENCE[f.presence];
          return (
            <View
              key={f.user.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingTop: i ? 10 : 0,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: colors.line,
              }}
            >
              <Avatar avatar={f.user.avatar} frame={f.user.frame} size={36} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong" numberOfLines={1}>
                  {f.user.username}
                </T>
                <T variant="caption" tone="fg3">
                  {p.label}
                </T>
              </View>
              {inRoom ? (
                <T variant="small" tone="good" style={{ fontFamily: fonts.semibold }}>
                  В стаята
                </T>
              ) : (
                <Button
                  title={wasSent ? '✓ Изпратено' : 'Покани'}
                  label={wasSent ? `Поканата до ${f.user.username} е изпратена` : `Покани ${f.user.username}`}
                  variant={wasSent ? 'ghost' : 'secondary'}
                  disabled={wasSent}
                  loading={sending === f.user.id}
                  onPress={() => void invite(f.user.id)}
                />
              )}
            </View>
          );
        })
      )}
    </Card>
  );
}
