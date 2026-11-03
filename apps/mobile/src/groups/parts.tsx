import { api, fmt, ordinal, plural, useStore } from '@almanac/client';
import { BRAND, GROUPS, type GroupInfo, type GroupSummary, shiftDay } from '@almanac/shared';
import { router } from 'expo-router';
import { Pressable, Share, View } from 'react-native';
import { API_URL } from '@/lib/client';
import { useLoad } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { T } from '@/ui';
import { Section } from '@/ui/controls';

/** "26 октомври" (a day key, as Sofia has it). */
export const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', timeZone: 'UTC' });
export const weekName = (monday: string) => `${dayName(monday)} – ${dayName(shiftDay(monday, 6))}`;

export const inviteUrl = (code: string) => `${API_URL}/groups/join/${code}`;

/** The group's invite, through the phone's share sheet. */
export const shareInvite = (g: Pick<GroupInfo, 'name' | 'code'>) =>
  void Share.share({
    message: `Влез в групата „${g.name}“ в ${BRAND.name}: всяка седмица — кой знае най-много от въпросите на деня.\n${inviteUrl(g.code)}`,
  });

/** How long a group's name may be — said again when a short one is sent. */
export function NameLength({ tooShort }: { tooShort: boolean }) {
  return (
    <T variant="caption" tone={tooShort ? 'bad' : 'fg3'} accessibilityLiveRegion="polite">
      {tooShort
        ? `Името е твърде кратко: поне ${GROUPS.name[0]} знака.`
        : `От ${GROUPS.name[0]} до ${GROUPS.name[1]} знака.`}
    </T>
  );
}

/** A group in a list: where you stand this week, and who leads. */
export function GroupRow({ group: g, compact = false }: { group: GroupSummary; compact?: boolean }) {
  const colors = useColors();
  const line = `${g.you ? `${ordinal(g.you.rank)} място` : 'тази седмица още нямаш точки'}${
    g.leader && !g.leader.you ? ` · ${g.leader.username} води с ${fmt(g.leader.score)}` : ''
  }${g.leader?.you ? ' · водиш!' : ''}${compact ? '' : ` · ${plural(g.members, 'член', 'членове')}`}`;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${g.name}: ${line}`}
      onPress={() => router.push({ pathname: '/groups/[id]', params: { id: String(g.id) } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: compact ? 6 : 14,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: compact ? 0 : 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.lineStrong : compact ? 'transparent' : colors.glass,
      })}
    >
      <View
        style={{
          width: compact ? 36 : 44,
          height: compact ? 36 : 44,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.glass,
        }}
      >
        <T style={{ fontSize: compact ? 18 : 22, lineHeight: compact ? 24 : 28 }}>{g.crown ? '👑' : '🫂'}</T>
      </View>
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" numberOfLines={1}>
          {g.name}
        </T>
        <T variant="small" tone="fg3" numberOfLines={1}>
          {line}
        </T>
      </View>
      <T tone="fg3">›</T>
    </Pressable>
  );
}

/** Приятели's word on groups: yours, or what one is, with the way to make one. */
export function GroupsSection() {
  const count = useStore((s) => s.me?.groups ?? 0);
  const { data } = useLoad(() => (count ? api.groups() : Promise.resolve({ groups: [] })), String(count));
  return (
    <Section title="Групи">
      {data?.groups.length ? (
        data.groups.map((g) => <GroupRow key={g.id} group={g} compact />)
      ) : (
        <T variant="small" tone="fg2">
          Клас, офис, семейство: седмична класация на въпросите на деня — сборът от най-добрите ти {GROUPS.bestDays}{' '}
          дни.
        </T>
      )}
      <Pressable accessibilityRole="link" onPress={() => router.push('/groups')} hitSlop={6}>
        <T variant="small" tone="link" style={{ fontFamily: fonts.semibold }}>
          {count ? 'Всички групи →' : 'Създай група →'}
        </T>
      </Pressable>
    </Section>
  );
}
