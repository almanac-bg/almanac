import {
  actions,
  api,
  countdown,
  fmt,
  offBoardLine,
  placeShown,
  plural,
  toast,
  useNow,
  useStore,
} from '@almanac/client';
import { BRAND, type DailyInfo, type DailyPreview, dayKey, dayTheme, MODES, TIME_ZONE } from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Share, View } from 'react-native';
import { MoreTimeNote } from '@/components/MoreTimeNote';
import { openPath } from '@/lib/links';
import { useLoad } from '@/lib/load';
import { DayField, dailyLink } from '@/results/Cards';
import { fonts, radius, useColors } from '@/theme';
import { Avatar, Button, Card, LoadError, Screen, T } from '@/ui';

const MODE = MODES.daily;
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', timeZone: TIME_ZONE });

/**
 * Today's questions (the web's DailyPage): from Играй, the streak's reminder, or a friend's link (`code`, whose result
 * is there to beat). Played, your result, the day's field, the questions to send on and the board.
 */
export function DailyScreen({ code }: { code: string | null }) {
  const version = useStore((s) => `${s.me?.daily.day}:${s.me?.daily.played}`);
  const { data: info, error, loading, reload } = useLoad(() => api.daily(), version);
  const { data: link } = useLoad<DailyPreview | null>(
    () => (code ? api.dailyPreview(code) : Promise.resolve(null)),
    code ?? '',
  );
  return (
    <Screen refreshing={loading && !!info} onRefresh={reload}>
      {!info && error ? (
        <LoadError title="Въпросите на деня не се заредиха" error={error} onRetry={reload} />
      ) : !info ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <Daily info={info} link={link ?? null} code={code} />
      )}
    </Screen>
  );
}

function Daily({ info, link, code }: { info: DailyInfo; link: DailyPreview | null; code: string | null }) {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const now = useNow(1000);
  const [starting, setStarting] = useState(false);
  if (!me) return null;
  // Your own link opened: nothing to compare with yourself.
  const sharer = link?.sharer && link.sharer.user.username !== me.username ? link.sharer : null;
  const theme = dayTheme(info.day);
  const play = async () => {
    setStarting(true);
    // The code as it is: the server ignores one that isn't today's, or is your own.
    const res = await actions.startDaily(code ?? undefined);
    setStarting(false);
    // Started, the match screen opens by itself.
    if (!res.ok) toast({ kind: 'error', title: res.error });
  };
  const share = async () => {
    const url = await dailyLink();
    const played = info.played;
    void Share.share({
      message: played
        ? `${BRAND.mark} ${BRAND.name} №${info.number} · ${played.correct}/${MODE.questions}\n${fmt(played.score)} т.\n${url}`
        : url,
    });
  };
  return (
    <>
      <Card accent={MODE.accent[0]}>
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 2,
            borderRadius: 999,
            experimental_backgroundImage: `linear-gradient(90deg, ${MODE.accent[0]}, ${MODE.accent[1]})`,
          }}
        >
          <T variant="label" style={{ color: '#451a03' }}>
            №{info.number} · {dayLabel(info.day)}
          </T>
        </View>
        <T variant="h1" role="heading">
          {MODE.name}
        </T>
        <T tone="fg2">{MODE.tagline}</T>
        {theme && (
          <Pressable accessibilityRole="link" onPress={() => openPath(theme.page)}>
            <T tone="gold" style={{ fontFamily: fonts.semibold }}>
              Темата днес:{' '}
              <T tone="gold" style={{ textDecorationLine: 'underline' }}>
                {theme.name}
              </T>
            </T>
          </Pressable>
        )}
        {sharer && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.ink2,
            }}
          >
            <Avatar avatar={sharer.user.avatar} frame={sharer.user.frame} size={40} />
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong" numberOfLines={1}>
                {sharer.user.username} те кани
              </T>
              <T variant="small" tone="fg2" style={{ fontVariant: ['tabular-nums'] }}>
                {sharer.correct}/{MODE.questions} · {fmt(sharer.score)} т. — можеш ли повече?
              </T>
            </View>
          </View>
        )}
        {info.played ? (
          <View style={{ gap: 8 }}>
            <T variant="caption" tone="fg3">
              Твоят резултат днес
            </T>
            <T variant="h1" style={{ fontVariant: ['tabular-nums'] }}>
              {fmt(info.played.score)} т.{' '}
              <T tone="fg2">
                · {info.played.correct}/{MODE.questions}
              </T>
              {!info.offBoard && placeShown(info.total) ? (
                <T tone="gold">
                  {' '}
                  · #{info.played.rank} <T tone="fg3">от {info.total}</T>
                </T>
              ) : null}
            </T>
            {info.offBoard && (
              <T variant="small" tone="fg3">
                {offBoardLine({
                  guest: me.isGuest,
                  madeToday: dayKey(me.createdAt) === info.day,
                  moreTime: info.moreTime,
                  rank: info.played.rank,
                  total: info.total,
                })}
              </T>
            )}
            {info.played.field && <DayField field={info.played.field} correct={info.played.correct} />}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Прати днешните въпроси" onPress={() => void share()} style={{ flex: 1 }} />
              <Button title="Класация" variant="secondary" onPress={() => router.navigate('/leaderboard')} />
            </View>
            <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
              Нови въпроси след {countdown(info.endsAt - now)}
            </T>
          </View>
        ) : info.attempted ? (
          <T tone="fg3">Днешният опит е използван. Нови въпроси след {countdown(info.endsAt - now)}.</T>
        ) : (
          <View style={{ gap: 8 }}>
            <Button title="Играй днешните →" variant="gold" size="lg" loading={starting} onPress={() => void play()} />
            <MoreTimeNote />
            <T variant="small" tone="fg3">
              {MODE.questions} въпроса, около три минути, без козове. Един опит до полунощ
              {info.total > 0
                ? ` · днес вече ${info.total === 1 ? 'игра' : 'играха'} ${plural(info.total, 'човек', 'души')}`
                : ''}
              .
            </T>
          </View>
        )}
      </Card>

      {info.fromMyLink.length > 0 && (
        <Card>
          <T variant="h2" role="heading">
            По твоя линк днес
          </T>
          {info.fromMyLink.map((p) => (
            <View key={p.user.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar avatar={p.user.avatar} frame={p.user.frame} size={28} />
              <T variant="small" style={{ flex: 1, fontFamily: fonts.semibold }} numberOfLines={1}>
                {p.user.username}
              </T>
              <T variant="small" tone="fg2" style={{ fontVariant: ['tabular-nums'] }}>
                {p.correct}/{MODE.questions} · {fmt(p.score)} т.
              </T>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}
