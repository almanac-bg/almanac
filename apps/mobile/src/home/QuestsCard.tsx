import { countdown, refreshMe, useNow, useStore } from '@almanac/client';
import type { QuestInfo } from '@almanac/shared';
import { useEffect } from 'react';
import { View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Card, Progress, T } from '@/ui';

/** Today's three quests (the web's QuestsCard): any match moves them along and pays their XP; all three, a bonus. */
export function QuestsCard() {
  const colors = useColors();
  const quests = useStore((s) => s.me?.quests);
  const now = useNow(1000);
  // Midnight in Sofia: a new set is up. Asked again now and then, in case this clock runs ahead of the server's.
  const expired = !!quests && now >= quests.endsAt;
  useEffect(() => {
    if (!expired) return;
    void refreshMe();
    const id = setInterval(() => void refreshMe(), 30_000);
    return () => clearInterval(id);
  }, [expired]);
  if (!quests?.quests.length) return null;
  const total = quests.quests.length;
  const done = quests.quests.filter((q) => q.done).length;
  return (
    <Card accent="#38bdf8">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <T variant="label" style={{ color: '#7dd3fc' }}>
          Всеки ден нови
        </T>
        <T variant="caption" tone={done === total ? 'good' : 'fg3'} style={{ fontFamily: fonts.bold }}>
          {done}/{total} изпълнени
        </T>
      </View>
      <T variant="h2" role="heading">
        Задачи за деня
      </T>
      <T variant="small" tone="fg3">
        Всеки мач брои. Щом изпълниш задача, XP идва сам.
      </T>
      <View style={{ gap: 14, marginTop: 4 }}>
        {quests.quests.map((q) => (
          <Quest key={q.id} quest={q} />
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: 12,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: quests.bonusDone ? `${colors.good}44` : `${colors.gold}33`,
          backgroundColor: quests.bonusDone ? `${colors.good}14` : `${colors.gold}10`,
        }}
      >
        <T>🎁</T>
        <T variant="small" tone="fg2" style={{ flex: 1 }}>
          {quests.bonusDone ? 'Бонусът за трите задачи е твой!' : 'Изпълни и трите за бонус'}
        </T>
        <T variant="small" tone={quests.bonusDone ? 'good' : 'gold'} style={{ fontFamily: fonts.bold }}>
          {quests.bonusDone ? '✓ ' : ''}+{quests.bonusXp} XP
        </T>
      </View>
      <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
        Нови задачи след {countdown(quests.endsAt - now)}
      </T>
    </Card>
  );
}

function Quest({ quest: q }: { quest: QuestInfo }) {
  const colors = useColors();
  const value = Math.min(q.progress, q.goal);
  return (
    <View
      accessible
      accessibilityLabel={`${q.text}: ${value} от ${q.goal}${q.done ? ', изпълнена' : ''}, +${q.xp} XP`}
      style={{ flexDirection: 'row', gap: 12 }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: q.done ? `${colors.good}26` : colors.glass,
        }}
      >
        <T style={{ fontSize: 20, lineHeight: 26 }}>{q.icon}</T>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <T variant="small" tone={q.done ? 'fg2' : 'fg'} style={{ flex: 1, fontFamily: fonts.semibold }}>
            {q.done ? '✓ ' : ''}
            {q.text}
          </T>
          <T variant="caption" tone={q.done ? 'good' : 'link'} style={{ fontFamily: fonts.bold }}>
            +{q.xp} XP
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Progress value={value / q.goal} height={6} color={q.done ? colors.good : '#a78bfa'} style={{ flex: 1 }} />
          <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
            {value}/{q.goal}
          </T>
        </View>
      </View>
    </View>
  );
}
