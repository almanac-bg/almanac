import { actions, api, challengeShareText, fmt, plural, timeAgo, toast, useNow, useStore } from '@almanac/client';
import { MODES, type MyChallenge } from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { API_URL } from '@/lib/client';
import { useLoad } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { Button, Card, T } from '@/ui';

/** How many of your own links the card lists (newest first). */
const LISTED = 3;

/**
 * „Предизвикай приятел“ (the web's ChallengeCard): a link with ten fixed questions. Making one starts it at once (the
 * match opens by itself); your recent links sit under it with who leads. A guest sees what it is and how to unlock it.
 */
export function ChallengeCard() {
  const guest = useStore((s) => !!s.me?.isGuest);
  const [busy, setBusy] = useState(false);
  const { data } = useLoad(() => (guest ? Promise.resolve(null) : api.myChallenges()), String(guest));
  const now = useNow(60_000);
  const recent = data?.challenges.slice(0, LISTED) ?? [];
  const create = async () => {
    setBusy(true);
    const res = await actions.startChallenge();
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  };
  return (
    <Card accent="#818cf8">
      <T variant="label" style={{ color: '#a5b4fc' }}>
        С линк
      </T>
      <T variant="h2" role="heading">
        Предизвикай приятел
      </T>
      <T variant="small" tone="fg3">
        {MODES.challenge.questions} въпроса, без козове. Изиграй ги и прати линка: всеки, който го отвори, играе същите
        въпроси веднъж. Линкът важи 7 дни.{guest ? ' Предизвикателства създават играчите с профил.' : ''}
      </T>
      {guest ? (
        <Button
          title="🔒 Създай предизвикателство"
          variant="secondary"
          hint="Предизвикателства по линк създават играчите с профил: запази своя в Настройки"
          onPress={() => router.push('/settings')}
        />
      ) : (
        <Button
          title="Създай предизвикателство"
          icon="⚔️"
          variant="secondary"
          loading={busy}
          onPress={() => void create()}
        />
      )}
      {recent.length > 0 && (
        <View style={{ gap: 8 }}>
          <T variant="label" tone="fg3">
            Твоите предизвикателства
          </T>
          {recent.map((c) => (
            <ChallengeRow key={c.id} challenge={c} now={now} />
          ))}
        </View>
      )}
    </Card>
  );
}

function ChallengeRow({ challenge: c, now }: { challenge: MyChallenge; now: number }) {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const expired = c.expiresAt <= now;
  const mine = c.leader?.username === me?.username;
  const lead = !c.leader
    ? 'Още няма резултати'
    : mine
      ? c.players > 1
        ? `Водиш с ${fmt(c.leader.score)} т.`
        : `${fmt(c.leader.score)} т. · чака съперници`
      : `${c.leader.username} води с ${fmt(c.leader.score)} т.`;
  const sub = `${plural(c.players, 'играч', 'играчи')} · ${expired ? 'изтекло' : `изтича ${timeAgo(c.expiresAt)}`}`;
  const made = new Date(c.createdAt).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' });
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingLeft: 12,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.ink2,
        opacity: expired ? 0.6 : 1,
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${lead}, ${sub}`}
        onPress={() => router.push({ pathname: '/c/[id]', params: { id: c.id } })}
        style={{ flex: 1, minHeight: 48, justifyContent: 'center', paddingVertical: 6 }}
      >
        <T variant="small" style={{ fontFamily: fonts.semibold }} numberOfLines={1}>
          {lead}
        </T>
        <T variant="caption" tone="fg3" numberOfLines={1}>
          {sub}
        </T>
      </Pressable>
      {!expired && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Сподели предизвикателството от ${made}`}
          onPress={() => void Share.share({ message: challengeShareText(API_URL, c.id, c.myScore) })}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            backgroundColor: pressed ? colors.lineStrong : 'transparent',
          })}
        >
          <T tone="fg3">↗</T>
        </Pressable>
      )}
    </View>
  );
}
