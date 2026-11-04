import { actions, api, countdown, fmt, toast, useNow, useStore } from '@almanac/client';
import { EVENING, type EveningStatus, MODES } from '@almanac/shared';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import { useLoad } from '@/lib/load';
import { fonts, useColors } from '@/theme';
import { Avatar, Button, Card, T } from '@/ui';

const waitingText = (n: number) => (n === 0 ? 'още никой не чака' : n === 1 ? '1 чака' : `${n} чакат`);

/**
 * „Вечерен Роял“ on Играй (the web's EveningCard): when tonight's starts (its lobby open from five minutes before, with
 * how many wait), and last night's top until the next one. `compact`: the rest of the day, a line saying when, no clock
 * ticking a day away.
 */
export function EveningCard({ compact = false }: { compact?: boolean }) {
  const colors = useColors();
  const now = useNow(1000);
  const live = useStore((s) => s.evening);
  const { data, reload } = useLoad(() => api.evening());
  const status: EveningStatus | null =
    live && data?.status && live.day === data.status.day ? live : (data?.status ?? null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const opening = !!status && now >= status.opensAt && now < status.startsAt;
  const over = !!status && now >= status.startsAt && !status.live;
  // Its matches over: the next evening's times, and tonight's top.
  useEffect(() => {
    if (over) reload();
  }, [over, reload]);
  // What changed, said as it changes — not what was so when the screen opened, and not the countdown every second.
  const news = status?.live
    ? 'Вечерният Роял започна.'
    : status?.joined
      ? 'Вътре си във вечерния Роял.'
      : opening
        ? 'Входът за вечерния Роял е отворен.'
        : '';
  const said = useRef(news);
  useEffect(() => {
    if (news && news !== said.current) AccessibilityInfo.announceForAccessibility(news);
    said.current = news;
  }, [news]);
  if (!data || (!status && !data.lastNight)) return null;
  const quiet = compact && !opening && !status?.joined && !status?.live;
  const night = data.lastNight;

  const join = async () => {
    setBusy(true);
    const res = await actions.joinEvening();
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
    else reload();
  };

  const at = status && new Date(status.startsAt).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  const line = !status
    ? 'Утре пак, в 21:00.'
    : status.live
      ? 'Тече в момента.'
      : status.joined
        ? `Вътре си · ${waitingText(status.waiting)} · започва след ${countdown(status.startsAt - now)}`
        : opening
          ? `Входът е отворен · ${waitingText(status.waiting)} · започва след ${countdown(status.startsAt - now)}`
          : quiet
            ? `Всяка вечер в ${at}, до ${EVENING.maxPlayers} души. Входът се отваря ${EVENING.lobbyMinutes} минути преди това.`
            : `Всяка вечер в ${at}, до ${EVENING.maxPlayers} души. Входът се отваря ${EVENING.lobbyMinutes} минути преди това · след ${countdown(status.opensAt - now)}`;
  return (
    <Card accent={MODES.evening.accent[0]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <T style={{ fontSize: quiet ? 24 : 32, lineHeight: quiet ? 30 : 40 }}>🌙</T>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="h2" role="heading">
            {MODES.evening.name}
          </T>
          <T variant="small" tone="fg2">
            {line}
          </T>
        </View>
      </View>
      {status?.joined ? (
        <Button title="Излез" variant="ghost" onPress={actions.leaveEvening} />
      ) : (
        opening && <Button title="Влез" variant="gold" loading={busy} onPress={() => void join()} />
      )}
      {night && (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((o) => !o)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}
          >
            <T variant="small" style={{ flex: 1 }} numberOfLines={1}>
              <T variant="small" tone="fg3">
                {night.day === status?.day ? 'Тази вечер' : 'Снощи'}:
              </T>{' '}
              👑{' '}
              <T variant="small" style={{ fontFamily: fonts.bold }}>
                {night.top[0]?.placement === 1 ? night.top[0].user.username : '—'}
              </T>
              <T variant="small" tone="fg3">
                {' '}
                · {night.players} играха
              </T>
            </T>
            <T tone="fg3">{open ? '▴' : '▾'}</T>
          </Pressable>
          {open &&
            night.top.map((t) => (
              <View key={t.user.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T variant="small" tone="fg3" style={{ width: 24, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {t.placement}.
                </T>
                <Avatar avatar={t.user.avatar} frame={t.user.frame} size={26} />
                <T variant="small" style={{ flex: 1 }} numberOfLines={1}>
                  {t.user.username}
                </T>
                <T variant="small" tone="fg2" style={{ fontVariant: ['tabular-nums'] }}>
                  {fmt(t.score)}
                </T>
              </View>
            ))}
        </View>
      )}
    </Card>
  );
}
