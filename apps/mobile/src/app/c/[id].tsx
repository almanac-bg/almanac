import { actions, api, fmt, ordinal, plural, seconds, timeAgo, useNow, useStore } from '@almanac/client';
import { BRAND, type ChallengeEntry, type ChallengeInfo, MODES, titleName } from '@almanac/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, View } from 'react-native';
import { MoreTimeNote } from '@/components/MoreTimeNote';
import { DuelCard } from '@/duels/parts';
import { API_URL } from '@/lib/client';
import { useLoad, useReloadOnFocus } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { Avatar, Button, Card, LoadError, Screen, T } from '@/ui';

const MODE = MODES.challenge;
const MEDALS = ['🥇', '🥈', '🥉'];
/** A link can go round a whole school: past this many rows the board shows the top and your own place. */
const BOARD_ROWS = 50;

/**
 * A challenge link, /c/<id> (the web's ChallengePage): ten questions, one try each, a board of everyone who played.
 * A friend duel is one too, for its two only: it shows as the duel.
 */
export default function ChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // A friend who played the duel sends a note: loaded again then, and when back from playing it.
  const version = useStore((s) => `${s.friendsVersion}:${s.me?.unreadNotifications ?? 0}`);
  const { data, error, status, loading, reload } = useLoad(() => api.challenge(id), `${id}:${version}`);
  useReloadOnFocus(reload);
  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      <Stack.Screen options={{ title: data?.duelOnly ? 'Дуел' : 'Предизвикателство' }} />
      {!data && error ? (
        status === 404 ? (
          <Missing />
        ) : (
          <LoadError title="Предизвикателството не се зареди" error={error} onRetry={reload} />
        )
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <Challenge info={data} />
      )}
    </Screen>
  );
}

function Challenge({ info }: { info: ChallengeInfo }) {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  const now = useNow(30_000);
  const [starting, setStarting] = useState(false);
  if (!me) return null;

  // The server says whether it's expired as of loading; the clock keeps it honest while the screen stays open.
  const expired = info.expired || now >= info.expiresAt;
  const mine = info.entries.find((e) => e.you) ?? null;
  const leader = info.entries[0] ?? null;
  const own = !!info.creator && info.creator.id === me.id;

  const accept = async () => {
    setStarting(true);
    const res = await actions.startChallenge(info.id);
    setStarting(false);
    // Started, the match screen opens by itself.
    if (!res.ok) Alert.alert('Не започна', res.error);
  };

  const share = () => {
    const score = mine?.score ?? leader?.score ?? null;
    const lead =
      mine !== null
        ? `Предизвиквам те в ${BRAND.name}: ${MODE.questions} въпроса. Можеш ли да биеш ${plural(mine.score, 'точка', 'точки')}?`
        : score !== null
          ? `Предизвикателство в ${BRAND.name}: ${MODE.questions} въпроса. Можеш ли да биеш ${plural(score, 'точка', 'точки')}?`
          : `Предизвикателство в ${BRAND.name}: ${MODE.questions} въпроса, един опит. Колко ще събереш?`;
    void Share.share({ message: `${lead}\n${API_URL}/c/${info.id}` });
  };

  // A friend duel: head to head, for its two; nobody else plays it.
  if (info.duelOnly) {
    return info.duel ? (
      <>
        <T variant="label" tone="fg3" align="center">
          Дуел с приятел
        </T>
        <T variant="h1" role="heading" align="center" style={{ fontFamily: fonts.bold }}>
          Ти срещу {info.duel.friend.username}
        </T>
        <DuelCard
          standing={info.duel}
          canPlay={!info.attempted && !expired}
          onPlay={() => void accept()}
          playing={starting || inGame}
        />
      </>
    ) : (
      <Empty
        icon="🤝"
        title="Този дуел е между двама приятели"
        body="Само двамата могат да го изиграят. Предизвикай свой приятел от Приятели."
      />
    );
  }

  const title = own
    ? 'Ти предизвикваш'
    : info.creator
      ? `${info.creator.username} те предизвиква`
      : 'Покажи какво знаеш';
  const clock = `${expired ? 'Изтече' : 'Изтича'} ${expired || info.expiresAt - now >= 60_000 ? timeAgo(info.expiresAt) : 'след минута'}`;

  return (
    <>
      <Card accent={MODE.accent[0]}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <T variant="label" style={{ color: colors.link }}>
            ⚔️ Предизвикателство
          </T>
          <T variant="caption" tone="fg3">
            🕐 {clock}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {info.creator && !own && <Avatar avatar={info.creator.avatar} frame={info.creator.frame} size={56} />}
          <View style={{ flex: 1, gap: 4 }}>
            <T variant="h1" role="heading" style={{ fontFamily: fonts.bold }}>
              {title}
            </T>
            <T variant="small" tone="fg3">
              {MODE.questions} въпроса · {MODE.timeMs / 1000} секунди за всеки · един опит · без козове
            </T>
          </View>
        </View>

        {mine ? (
          <YourResult entry={mine} total={info.total} expired={expired} />
        ) : expired ? (
          <Note
            text={
              info.attempted
                ? 'Предизвикателството изтече, а опитът ти не завърши.'
                : 'Предизвикателството изтече, преди да го изиграеш. Ето как завърши.'
            }
          />
        ) : info.attempted ? (
          inGame ? (
            <View style={{ gap: 10 }}>
              <Note text="Играеш го в момента — резултатът ще се появи тук." />
              <Button title="Към играта" variant="secondary" onPress={() => router.push('/game')} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Note
                tone="gold"
                text="Опитът ти не завърши. Ако играта прекъсна по наша вина, можеш да го изиграеш отново."
              />
              <Button title="↻ Опитай пак" variant="secondary" loading={starting} onPress={() => void accept()} />
            </View>
          )
        ) : (
          <View style={{ gap: 10 }}>
            <View>
              <T variant="label" tone="fg3">
                Резултат за биене
              </T>
              {leader ? (
                <>
                  <T variant="hero" style={{ fontVariant: ['tabular-nums'] }}>
                    {fmt(leader.score)} т.
                  </T>
                  <T variant="small" tone="fg3" numberOfLines={1}>
                    {leader.user?.username ?? 'Изтрит играч'} · {leader.correct}/{MODE.questions} верни
                  </T>
                </>
              ) : (
                <T tone="fg2">Още никой не го е изиграл — постави първия резултат.</T>
              )}
            </View>
            <Button
              title="⚔️ Приеми предизвикателството"
              size="lg"
              loading={starting}
              disabled={inGame}
              hint={inGame ? 'Довърши мача, в който си' : undefined}
              onPress={() => void accept()}
            />
            <MoreTimeNote />
          </View>
        )}

        {!expired && (
          <View style={{ gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line }}>
            <T variant="small" tone="fg3">
              Прати линка: всеки, който го отвори, играе същите въпроси веднъж — дори без профил.
            </T>
            <Button title="Сподели линка" variant={own || mine ? 'primary' : 'secondary'} onPress={share} />
          </View>
        )}
      </Card>

      <Board info={info} />
      <CreateOwn />
    </>
  );
}

function Note({ text, tone = 'fg2' }: { text: string; tone?: 'fg2' | 'gold' }) {
  const colors = useColors();
  return (
    <View
      style={{
        padding: 14,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: tone === 'gold' ? `${colors.gold}55` : colors.line,
        backgroundColor: tone === 'gold' ? `${colors.gold}14` : colors.ink2,
      }}
    >
      <T variant="small" tone={tone}>
        {text}
      </T>
    </View>
  );
}

function YourResult({ entry, total, expired }: { entry: ChallengeEntry; total: number; expired: boolean }) {
  const first = entry.rank === 1;
  const note = first
    ? total === 1
      ? 'Първият резултат е твой. Прати линка и виж кой ще го бие.'
      : expired
        ? `Най-добрият резултат от ${total} играчи.`
        : `Водиш пред още ${plural(total - 1, 'играч', 'играчи')}.`
    : `${ordinal(entry.rank)} място от ${total}.`;
  return (
    <View accessible style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <T style={{ fontSize: 40, lineHeight: 48 }}>{MEDALS[entry.rank - 1] ?? '🎯'}</T>
      <View style={{ flex: 1 }}>
        <T variant="label" tone="fg3">
          {expired ? 'Краен резултат' : 'Твоят резултат'}
        </T>
        <T variant="hero" style={{ fontVariant: ['tabular-nums'] }}>
          {fmt(entry.score)} т.
        </T>
        <T variant="small" tone="fg2">
          {entry.correct}/{MODE.questions} верни · {note}
        </T>
      </View>
    </View>
  );
}

function Board({ info }: { info: ChallengeInfo }) {
  const colors = useColors();
  const { entries } = info;
  const shown = entries.slice(0, BOARD_ROWS);
  const mine = entries.find((e) => e.you);
  const mineHidden = !!mine && mine.rank > BOARD_ROWS;
  const creatorId = info.creator?.id ?? null;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <T variant="h2" role="heading">
          Класиране
        </T>
        {info.total > 0 && (
          <T variant="small" tone="fg3">
            {plural(info.total, 'играч', 'играчи')}
          </T>
        )}
      </View>
      {entries.length === 0 ? (
        <Empty
          icon="🏁"
          title="Още няма резултати"
          body={
            info.expired
              ? 'Никой не го изигра навреме.'
              : 'Първият резултат оглавява класацията — и всеки следващ трябва да го бие.'
          }
        />
      ) : (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {shown.map((e, i) => (
            <View key={e.rank} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <EntryRow entry={e} creatorId={creatorId} />
            </View>
          ))}
          {mineHidden && (
            <>
              <T variant="caption" tone="fg3" align="center">
                ⋯
              </T>
              <EntryRow entry={mine} creatorId={creatorId} />
            </>
          )}
        </Card>
      )}
    </>
  );
}

function EntryRow({ entry, creatorId }: { entry: ChallengeEntry; creatorId: number | null }) {
  const colors = useColors();
  const { user } = entry;
  const author = !!user && user.id === creatorId;
  const name = user?.username ?? 'Изтрит играч';
  const sub = `${entry.you ? 'Ти · ' : ''}${author ? 'Автор' : user ? titleName(user.title) : ''}`;
  const said = `${ordinal(entry.rank)} място: ${name}${entry.you ? ' (ти)' : ''}, ${fmt(entry.score)} т., ${entry.correct} от ${MODE.questions} верни за ${seconds(entry.timeMs)}`;
  const body = (
    <>
      <T variant="bodyStrong" style={{ minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
        {MEDALS[entry.rank - 1] ?? entry.rank}
      </T>
      {user ? (
        <Avatar avatar={user.avatar} frame={user.frame} size={36} />
      ) : (
        <T style={{ fontSize: 26, lineHeight: 32 }}>❔</T>
      )}
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" numberOfLines={1}>
          {name}
        </T>
        {sub ? (
          <T variant="caption" tone={entry.you ? 'link' : 'fg3'} numberOfLines={1}>
            {sub}
          </T>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {fmt(entry.score)} т.
        </T>
        <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
          {entry.correct}/{MODE.questions}
        </T>
      </View>
    </>
  );
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    backgroundColor: entry.you ? `${colors.violet}18` : undefined,
  };
  return user ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={said}
      accessibilityHint="Отваря профила"
      onPress={() => router.push({ pathname: '/profile/[username]', params: { username: user.username } })}
      style={({ pressed }) => [row, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={said} style={row}>
      {body}
    </View>
  );
}

/** Making one of your own: ten fresh questions, played first by you, then the link goes to whoever you like. */
function CreateOwn() {
  const guest = useStore((s) => !!s.me?.isGuest);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const res = await actions.startChallenge();
    setBusy(false);
    if (!res.ok) Alert.alert('Не започна', res.error);
  };
  return (
    <Card>
      <T variant="h2" role="heading">
        Предизвикай и ти
      </T>
      <T variant="small" tone="fg3">
        {guest
          ? 'Свои предизвикателства правят играчи с профил. Запази прогреса си — отнема 10 секунди.'
          : `${MODE.questions} нови въпроса: изиграй ги първо ти, после прати линка на когото искаш.`}
      </T>
      {guest ? (
        <Button title="Запази прогреса" variant="secondary" onPress={() => router.push('/settings')} />
      ) : (
        <Button
          title="Създай предизвикателство"
          variant="secondary"
          loading={busy}
          disabled={inGame}
          onPress={() => void create()}
        />
      )}
    </Card>
  );
}

function Missing() {
  return (
    <>
      <Empty
        icon="🔗"
        title="Линкът не работи"
        body="Няма такова предизвикателство — линкът може да е непълен или вече изтрит."
      />
      <CreateOwn />
    </>
  );
}

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <Card style={{ alignItems: 'center' }}>
      <T style={{ fontSize: 40, lineHeight: 48 }}>{icon}</T>
      <T variant="title" align="center" role="heading">
        {title}
      </T>
      <T tone="fg2" align="center">
        {body}
      </T>
    </Card>
  );
}
