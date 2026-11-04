import { actions, api, duelLine, duelStatus, fmt, recordLine, useNow, useStore } from '@almanac/client';
import {
  CATEGORIES,
  type CategoryId,
  type DuelEntry,
  type DuelStanding,
  MODES,
  type PublicUser,
  ROUNDS,
} from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLoad } from '@/lib/load';
import { fonts, gutter, radius, useColors } from '@/theme';
import { Avatar, Button, Card, T } from '@/ui';

/** Your friend duels, loaded again when news comes in (a friend played, a note arrived). A guest has none. */
export function useDuels() {
  const guest = useStore((s) => !s.me || s.me.isGuest);
  const version = useStore((s) => `${s.friendsVersion}:${s.me?.unreadNotifications ?? 0}`);
  return useLoad(() => (guest ? Promise.resolve({ duels: [] as DuelEntry[] }) : api.duels()), `${guest}:${version}`);
}

/** Plays a duel that's waiting for you (the match screen opens by itself). */
export function usePlayDuel() {
  const [playing, setPlaying] = useState<string | null>(null);
  const play = async (id: string) => {
    setPlaying(id);
    const res = await actions.startChallenge(id);
    setPlaying(null);
    if (!res.ok) Alert.alert('Дуелът не започна', res.error);
  };
  return { playing, play };
}

const openDuel = (id: string) => router.push({ pathname: '/c/[id]', params: { id } });
const openProfile = (username: string) => router.push({ pathname: '/profile/[username]', params: { username } });

/** One duel in a list: who, whose turn or how it ended (opens the duel), and „Играй“ when it's yours. */
export function DuelRow({ duel, onPlay, playing }: { duel: DuelEntry; onPlay: () => void; playing: boolean }) {
  const colors = useColors();
  const now = useNow(60_000);
  const line = duelLine(duel, now);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Дуел с ${duel.friend.username}: ${duel.state === 'yours' ? 'твой ред, ' : ''}${line}`}
        onPress={() => openDuel(duel.id)}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Avatar avatar={duel.friend.avatar} frame={duel.friend.frame} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 }}>
            <T variant="bodyStrong" numberOfLines={1}>
              {duel.friend.username}
            </T>
            {duel.state === 'yours' && (
              <View style={{ paddingHorizontal: 8, borderRadius: 999, backgroundColor: `${colors.gold}26` }}>
                <T variant="caption" tone="gold" style={{ fontFamily: fonts.bold }}>
                  Твой ред
                </T>
              </View>
            )}
          </View>
          <T variant="caption" tone={duel.outcome === 'won' ? 'gold' : duel.outcome === 'lost' ? 'bad' : 'fg3'}>
            {line}
          </T>
        </View>
      </Pressable>
      {duel.state === 'yours' && <Button title="Играй" loading={playing} onPress={onPlay} />}
    </View>
  );
}

/** Your duels: the ones waiting for you first, then the ones waiting for them, then the week's results. */
export function DuelList({ duels }: { duels: DuelEntry[] }) {
  const colors = useColors();
  const { playing, play } = usePlayDuel();
  return (
    <View>
      {duels.map((d, i) => (
        <View key={d.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
          <DuelRow duel={d} onPlay={() => void play(d.id)} playing={playing === d.id} />
        </View>
      ))}
    </View>
  );
}

/**
 * A duel head to head, for one of its two (the web's DuelCard): both scores (or whose turn it is), how it ended, and
 * the two of them so far; then what's next — playing it, or a rematch.
 */
export function DuelCard({
  standing,
  canPlay,
  onPlay,
  playing,
  actions: withActions = true,
}: {
  standing: DuelStanding;
  /** Not played yet by you, and still open. */
  canPlay: boolean;
  onPlay: () => void;
  playing: boolean;
  /** Its play or rematch button (the results keep theirs in the bar at the bottom). */
  actions?: boolean;
}) {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const now = useNow(60_000);
  const { friend, mine, theirs, outcome, record, expired } = standing;
  if (!me) return null;
  return (
    <Card>
      <T
        variant="bodyStrong"
        align="center"
        tone={outcome === 'won' ? 'gold' : outcome === 'lost' ? 'bad' : 'fg2'}
        accessibilityLiveRegion="polite"
      >
        {duelStatus(standing, now)}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Side who={me} run={mine} you />
        <T
          variant="h2"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ marginTop: 22, color: colors.violet, fontStyle: 'italic' }}
        >
          VS
        </T>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Отваря профила"
          onPress={() => openProfile(friend.username)}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}
        >
          <Side who={friend} run={theirs} />
        </Pressable>
      </View>
      <T variant="small" tone="fg3" align="center">
        Дуели помежду ви:{' '}
        <T variant="small" style={{ fontFamily: fonts.bold, color: colors.fg }}>
          {recordLine(record)}
        </T>
      </T>
      {!withActions ? null : canPlay && !expired ? (
        <Button title="⚔️ Играй дуела" loading={playing} onPress={onPlay} />
      ) : outcome || expired ? (
        <RematchButton standing={standing} />
      ) : null}
    </Card>
  );
}

function Side({
  who,
  run,
  you = false,
}: {
  who: Pick<PublicUser, 'avatar' | 'frame' | 'username'>;
  run: DuelStanding['mine'];
  you?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${you ? 'Ти' : who.username}: ${run ? `${fmt(run.score)} т., ${run.correct} от ${MODES.challenge.questions} верни${run.moreTime ? ', с повече време' : ''}` : 'още не е играно'}`}
      style={{ flex: 1, alignItems: 'center', gap: 4 }}
    >
      <Avatar avatar={who.avatar} frame={who.frame} size={56} />
      <T variant="small" tone={you ? 'link' : 'fg'} numberOfLines={1} style={{ fontFamily: fonts.semibold }}>
        {you ? 'Ти' : who.username}
      </T>
      <T variant="h1" style={{ fontVariant: ['tabular-nums'] }}>
        {run ? fmt(run.score) : '—'}
      </T>
      {run && (
        <T variant="caption" tone="fg3">
          {run.correct} от {MODES.challenge.questions} верни
        </T>
      )}
      {run?.moreTime && (
        <T variant="caption" tone="link">
          ⏱ с повече време
        </T>
      )}
    </View>
  );
}

/**
 * The next duel with the same friend. Whoever lost the last one picks its categories (one a round, in order); the
 * winner's is drawn.
 */
export function RematchButton({ standing }: { standing: DuelStanding }) {
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const go = async (categories?: CategoryId[]) => {
    setBusy(true);
    const res = await actions.startDuel(standing.friend.id, categories);
    setBusy(false);
    if (res.ok) setPicking(false);
    else Alert.alert('Реваншът не започна', res.error);
  };
  return (
    <>
      <Button
        title="↻ Реванш"
        variant="secondary"
        loading={busy && !picking}
        disabled={inGame}
        onPress={() => (standing.canPick ? setPicking(true) : void go())}
      />
      {standing.canPick && (
        <RematchPicker open={picking} busy={busy} onClose={() => setPicking(false)} onPlay={(c) => void go(c)} />
      )}
    </>
  );
}

/** Lost the last duel: the rematch's three categories, one a round, in order (a tap again takes one back). */
function RematchPicker({
  open,
  busy,
  onClose,
  onPlay,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onPlay: (categories: CategoryId[]) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<CategoryId[]>([]);
  const toggle = (id: CategoryId) =>
    setPicked((p) => (p.includes(id) ? p.filter((c) => c !== id) : p.length < ROUNDS.count ? [...p, id] : p));
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.ink }}
        contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + 24, gap: 14 }}
      >
        <T variant="h1" role="heading">
          Избери категориите
        </T>
        <T tone="fg2">
          Последния дуел го загуби, затова реваншът е на твоя терен: по една категория за всеки от трите рунда, по ред.
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORIES.map((c) => {
            const at = picked.indexOf(c.id);
            return (
              <Pressable
                key={c.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: at >= 0 }}
                accessibilityLabel={`${c.name}${at >= 0 ? `, рунд ${at + 1}` : ''}`}
                onPress={() => toggle(c.id)}
                style={{
                  flexGrow: 1,
                  flexBasis: '45%',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 48,
                  paddingHorizontal: 12,
                  borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  borderWidth: 1,
                  borderColor: at >= 0 ? colors.violet : colors.line,
                  backgroundColor: at >= 0 ? `${colors.violet}26` : colors.ink2,
                }}
              >
                <T>{c.icon}</T>
                <T variant="small" style={{ flex: 1, fontFamily: fonts.semibold }}>
                  {c.name}
                </T>
                {at >= 0 && (
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#7c3aed',
                    }}
                  >
                    <T variant="caption" style={{ color: '#fff', fontFamily: fonts.bold }}>
                      {at + 1}
                    </T>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Отказ" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Button
            title={`⚔️ Играй (${picked.length}/${ROUNDS.count})`}
            disabled={picked.length !== ROUNDS.count}
            loading={busy}
            onPress={() => onPlay(picked)}
            style={{ flex: 1 }}
          />
        </View>
      </ScrollView>
    </Modal>
  );
}
