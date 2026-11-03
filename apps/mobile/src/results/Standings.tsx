import {
  api,
  BIG_MATCH,
  errorMessage,
  fmt,
  type LiveGame,
  ordinal,
  plural,
  toast,
  topAndYou,
  useStore,
} from '@almanac/client';
import {
  avatarEmoji,
  type FinalStanding,
  type Friendship,
  type FriendsResponse,
  type GameEndPayload,
  type GamePlayer,
  type MatchRewards,
  TEAMS,
  type TeamId,
  titleName,
} from '@almanac/shared';
import { router } from 'expo-router';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLoad } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { Button, Card, T } from '@/ui';

// ─── „+ Приятел“ beside the people you played with ─────────────────────────────

interface Friends {
  data: FriendsResponse | null;
  /** The list failed to load: offer the button anyway (the server answers "already friends" if so). */
  failed: boolean;
  update: (next: FriendsResponse) => void;
}
const FriendsContext = createContext<Friends | null>(null);

/** Someone you could add from the results: a human other than you, with a real account (a guest saves theirs first). */
const addable = (p: GamePlayer, youId: string) => p.id !== youId && !p.isBot && !p.isGuest && p.userId !== null;

function relation(data: FriendsResponse, userId: number): Friendship {
  if (data.friends.some((f) => f.user.id === userId)) return 'friends';
  if (data.outgoing.some((f) => f.user.id === userId)) return 'outgoing';
  if (data.incoming.some((f) => f.user.id === userId)) return 'incoming';
  return 'none';
}

/**
 * Loads your friends once for the results (fresh as they change), so each opponent's button knows where you stand.
 * Nothing loads for a guest, or a match with nobody to add.
 */
export function FriendsProvider({ game, children }: { game: LiveGame; children: ReactNode }) {
  const guest = useStore((s) => !!s.me?.isGuest);
  const version = useStore((s) => s.friendsVersion);
  const wanted = !guest && Object.values(game.players).some((p) => addable(p, game.start.youId));
  const { data, error, set } = useLoad(() => (wanted ? api.friends() : Promise.resolve(null)), `${wanted}:${version}`);
  return (
    <FriendsContext.Provider value={wanted ? { data, failed: !!error && !data, update: set } : null}>
      {children}
    </FriendsContext.Provider>
  );
}

/** „+ Приятел“ beside an opponent, or where things stand: request sent, theirs to accept, friends already. */
function FriendButton({ player, youId }: { player: GamePlayer; youId: string }) {
  const colors = useColors();
  const friends = useContext(FriendsContext);
  const [busy, setBusy] = useState(false);
  if (!friends || !addable(player, youId)) return null;
  const { data, failed, update } = friends;
  // Until the list is in, nothing: a button that turns into „Приятели“ a moment later would be a false offer.
  if (!data && !failed) return null;
  const state = data ? relation(data, player.userId!) : 'none';
  if (state === 'friends' || state === 'outgoing')
    return (
      <T
        variant="caption"
        tone={state === 'friends' ? 'good' : 'fg3'}
        accessibilityLabel={
          state === 'friends' ? `Приятели сте с ${player.name}` : `Поканата до ${player.name} е изпратена`
        }
        style={{ fontFamily: fonts.semibold }}
      >
        ✓ {state === 'friends' ? 'Приятели' : 'Изпратена'}
      </T>
    );
  const incoming = state === 'incoming';
  const add = async () => {
    setBusy(true);
    try {
      const next = await api.addFriend(player.name);
      update(next);
      toast(
        relation(next, player.userId!) === 'friends'
          ? { kind: 'success', title: `Вече сте приятели с ${player.name}!` }
          : { kind: 'success', title: 'Поканата е изпратена', body: `${player.name} ще я види в „Приятели“.` },
      );
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        incoming ? `Приеми поканата за приятелство от ${player.name}` : `Добави ${player.name} за приятел`
      }
      onPress={() => void add()}
      disabled={busy}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: 10,
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.lineStrong,
        backgroundColor: pressed ? colors.lineStrong : 'transparent',
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" />
      ) : (
        <T variant="caption" tone="link" style={{ fontFamily: fonts.semibold }}>
          {incoming ? '✓ Приеми' : '+ Приятел'}
        </T>
      )}
    </Pressable>
  );
}

// ─── Standings ───────────────────────────────────────────────────────────────

/** A bot or a recording isn't a person in the match: said beside the score. */
const machineTag = (p: GamePlayer) => (p.isBot ? 'БОТ' : p.record ? 'ЗАПИС' : null);

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/**
 * Who placed where: the top three on a podium (second, first, third), then the rest — a class's room shows the next
 * few and you, not everyone. Equal points on the podium get a line on how the places were decided.
 */
export function Podium({ game, standings }: { game: LiveGame; standings: FinalStanding[] }) {
  const colors = useColors();
  const youId = game.start.youId;
  const top = standings.slice(0, 3);
  const order = top.length === 1 ? top : [top[1], top[0], top[2]].filter((s): s is FinalStanding => !!s);
  const heights: Record<number, number> = { 1: 96, 2: 68, 3: 48 };
  const { shown: rest, gap } =
    standings.length > BIG_MATCH ? topAndYou(standings.slice(3), youId, 7) : { shown: standings.slice(3), gap: null };
  const tied = top.some(
    (s, i) =>
      i > 0 &&
      s.score === top[i - 1]!.score &&
      s.eliminatedAt === top[i - 1]!.eliminatedAt &&
      !s.left &&
      !top[i - 1]!.left,
  );
  return (
    <View style={{ gap: 10 }}>
      <View
        accessibilityRole="list"
        accessibilityLabel="Класиране"
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}
      >
        {order.map((s) => {
          const p = game.players[s.id];
          if (!p) return null;
          const me = s.id === youId;
          const tag = machineTag(p);
          return (
            <View
              key={s.id}
              accessible
              accessibilityLabel={`${ordinal(s.placement)} място: ${p.name}${me ? ' (ти)' : ''}, ${s.left ? 'напусна' : `${fmt(s.score)} т.`}${tag ? `, ${tag.toLowerCase()}` : ''}`}
              style={{ flex: 1, alignItems: 'center', gap: 4 }}
            >
              {s.placement === 1 && <T style={{ fontSize: 30, lineHeight: 36 }}>👑</T>}
              <T
                style={{
                  fontSize: s.placement === 1 ? 44 : 34,
                  lineHeight: s.placement === 1 ? 52 : 42,
                  opacity: s.left ? 0.5 : 1,
                }}
              >
                {avatarEmoji(p.avatar)}
              </T>
              <T variant="small" tone={me ? 'link' : 'fg'} numberOfLines={1} style={{ fontFamily: fonts.semibold }}>
                {p.name}
              </T>
              <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
                {s.left ? 'напусна' : `${fmt(s.score)} т.`}
                {tag ? ` · ${tag}` : ''}
              </T>
              <View
                style={{
                  alignSelf: 'stretch',
                  height: heights[s.placement] ?? 40,
                  alignItems: 'center',
                  paddingTop: 8,
                  borderTopLeftRadius: radius.lg,
                  borderTopRightRadius: radius.lg,
                  borderWidth: 1,
                  borderBottomWidth: 0,
                  borderColor: colors.line,
                  backgroundColor: s.placement === 1 ? `${colors.gold}30` : colors.glass,
                }}
              >
                <T style={{ fontSize: 24, lineHeight: 30 }}>{MEDALS[s.placement]}</T>
              </View>
            </View>
          );
        })}
      </View>
      {/* The friend buttons under the podium: in its narrow columns they'd squeeze the names. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
        {top.map((s) => {
          const p = game.players[s.id];
          return p ? <FriendButtonNamed key={s.id} player={p} youId={youId} /> : null;
        })}
      </View>
      {tied && (
        <T variant="small" tone="fg3" align="center">
          При равни точки по-напред е който има повече верни отговори, после — по-бързият.
        </T>
      )}
      {rest.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {rest.map((s, i) => {
            const p = game.players[s.id];
            if (!p) return null;
            return <Row key={s.id} s={s} p={p} you={s.id === youId} youId={youId} gapBefore={i === gap} />;
          })}
        </Card>
      )}
    </View>
  );
}

/** Under the podium a friend button needs the name with it: three in a row would say nothing of whose. */
function FriendButtonNamed({ player, youId }: { player: GamePlayer; youId: string }) {
  const friends = useContext(FriendsContext);
  if (!friends || !addable(player, youId)) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <T variant="caption" tone="fg3" numberOfLines={1} style={{ maxWidth: 100 }}>
        {player.name}
      </T>
      <FriendButton player={player} youId={youId} />
    </View>
  );
}

function Row({
  s,
  p,
  you,
  youId,
  gapBefore,
}: {
  s: FinalStanding;
  p: GamePlayer;
  you: boolean;
  youId: string;
  gapBefore: boolean;
}) {
  const colors = useColors();
  const tag = machineTag(p);
  const value = s.left ? 'напусна' : s.eliminatedAt !== null ? `💀 ${s.eliminatedAt}` : fmt(s.score);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 6,
        marginTop: gapBefore ? 16 : 0,
        borderRadius: radius.md,
        backgroundColor: you ? `${colors.violet}1f` : undefined,
      }}
    >
      <View
        accessible
        accessibilityLabel={`${ordinal(s.placement)} място: ${p.name}${you ? ' (ти)' : ''}, ${s.left ? 'напусна' : s.eliminatedAt !== null ? `отпадна след въпрос ${s.eliminatedAt}` : `${fmt(s.score)} т.`}${tag ? `, ${tag.toLowerCase()}` : ''}`}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <T variant="small" tone="fg3" style={{ width: 40, fontFamily: fonts.bold }}>
          {ordinal(s.placement)}
        </T>
        <T style={{ fontSize: 24, lineHeight: 30, opacity: s.left ? 0.5 : 1 }}>{avatarEmoji(p.avatar)}</T>
        <View style={{ flex: 1 }}>
          <T variant="small" numberOfLines={1} style={{ fontFamily: fonts.semibold }}>
            {p.name}
            {tag ? `  · ${tag}` : ''}
          </T>
          {!p.isBot && !p.record && p.title ? (
            <T variant="caption" tone="fg3" numberOfLines={1}>
              {titleName(p.title)}
            </T>
          ) : null}
        </View>
        <T variant="small" tone="fg2" style={{ fontVariant: ['tabular-nums'] }}>
          {value}
        </T>
      </View>
      <FriendButton player={p} youId={youId} />
    </View>
  );
}

/** Team games: the two teams with their totals and members, the winners crowned. */
export function TeamResult({ game, end }: { game: LiveGame; end: GameEndPayload }) {
  const colors = useColors();
  const scores = end.teamScores!;
  const winner = scores[0]?.team;
  const myTeam = game.players[game.start.youId]?.team ?? null;
  return (
    <View style={{ gap: 10 }}>
      {([0, 1] as TeamId[]).map((team) => {
        const { name, color } = TEAMS[team];
        const won = team === winner;
        const total = scores.find((x) => x.team === team)?.score ?? 0;
        const members = end.standings
          .filter((s) => game.players[s.id]?.team === team)
          .sort((a, b) => b.score - a.score);
        return (
          <View
            key={team}
            style={{
              gap: 6,
              padding: 14,
              borderRadius: radius.xl,
              borderCurve: 'continuous',
              borderWidth: won ? 2 : 1,
              borderColor: won ? color : `${color}44`,
              backgroundColor: `${color}12`,
              opacity: won ? 1 : 0.9,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View>
                <T variant="title">
                  {won ? '👑 ' : ''}
                  {name}
                </T>
                <T variant="caption" tone="fg3">
                  {myTeam === team ? 'Твоят отбор' : 'Съперници'}
                </T>
              </View>
              <T variant="h1" style={{ fontVariant: ['tabular-nums'] }}>
                {fmt(total)}
              </T>
            </View>
            {members.map((s) => {
              const p = game.players[s.id];
              if (!p) return null;
              return (
                <View
                  key={s.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 6,
                    paddingHorizontal: 6,
                    borderRadius: radius.md,
                    backgroundColor: s.id === game.start.youId ? `${colors.violet}1f` : undefined,
                  }}
                >
                  <T style={{ fontSize: 22, lineHeight: 28 }}>{avatarEmoji(p.avatar)}</T>
                  <T variant="small" style={{ flex: 1, fontFamily: fonts.semibold }} numberOfLines={1}>
                    {p.name}
                    {machineTag(p) ? `  · ${machineTag(p)}` : ''}
                  </T>
                  <FriendButton player={p} youId={game.start.youId} />
                  <T variant="small" tone="fg2" style={{ fontVariant: ['tabular-nums'] }}>
                    {s.left ? 'напусна' : fmt(s.score)}
                  </T>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/**
 * A challenge link's result, where a match would show its podium: your place among everyone who played the link (the
 * first to finish it sets the score the others chase), and the link to pass on.
 */
export function ChallengeStanding({
  challenge,
  onShare,
}: {
  challenge: NonNullable<MatchRewards['challenge']>;
  onShare: () => void;
}) {
  const colors = useColors();
  const first = challenge.total <= 1;
  return (
    <Card accent="#818cf8" style={{ alignItems: 'center' }}>
      {first ? (
        <>
          <T variant="h2" role="heading" align="center">
            Сега прати линка
          </T>
          <T variant="small" tone="fg2" align="center">
            Всеки, който го отвори, играе същите въпроси веднъж, без козове. Линкът важи 7 дни.
          </T>
        </>
      ) : (
        <>
          <T
            variant="hero"
            accessibilityLabel={`${ordinal(challenge.rank)} място от ${plural(challenge.total, 'играч', 'играчи')} по линка`}
            style={{ color: challenge.rank === 1 ? colors.gold : '#a5b4fc' }}
          >
            #{challenge.rank} <T tone="fg2">от {plural(challenge.total, 'играч', 'играчи')}</T>
          </T>
          <T variant="caption" tone="fg3" align="center">
            Класацията се променя, докато другите играят линка.
          </T>
        </>
      )}
      <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
        <Button title="Сподели линка" onPress={onShare} style={{ flex: 1 }} />
        <Button
          title="Виж класацията"
          variant="secondary"
          onPress={() => router.push({ pathname: '/c/[id]', params: { id: challenge.id } })}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}
