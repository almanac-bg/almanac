import {
  api,
  dailyShareText,
  errorMessage,
  fmt,
  keepTogether,
  numberText,
  offBoardWhy,
  percent,
  placeShown,
  plural,
  type ReviewItem,
  setState,
  toast,
  unlockPreview,
  useStore,
} from '@almanac/client';
import {
  achievementById,
  type CategoryMastery,
  categoryById,
  DAILY_FIELD,
  type DailyField,
  type DailySharer,
  dayKey,
  levelProgress,
  MASTERY_TIERS,
  type MatchRewards,
  masteryName,
  RARITIES,
  RATED_AFTER,
  RATED_GAMES_PER_PAIR,
  rankFor,
  sentences,
  type UnratedReason,
} from '@almanac/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { API_URL } from '@/lib/client';
import { RankBadge } from '@/profile/parts';
import { fonts, radius, useColors } from '@/theme';
import { Avatar, Button, Card, IconText, Progress, T } from '@/ui';

function Heading({ title }: { title: string }) {
  return (
    <T variant="h2" role="heading">
      {title}
    </T>
  );
}

/** The player's link to today's questions: the same ten for whoever opens it (the day's page without it). */
export async function dailyLink(): Promise<string> {
  try {
    return `${API_URL}/daily/${(await api.dailyLink()).code}`;
  } catch {
    return `${API_URL}/daily`;
  }
}

/**
 * The day's standing (off the board, where the run would stand on it), how the day went for everyone, the friend whose
 * link it came from, the streak and its shields — and the day's questions to send on.
 */
export function DailyResult({
  daily,
  history,
  total,
  score,
}: {
  daily: NonNullable<MatchRewards['daily']>;
  history: ReviewItem[];
  total: number;
  score: number;
}) {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const day = dayKey();
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    void dailyLink().then(setLink);
  }, []);
  const correct = history.filter((h) => h.right).length;
  const text =
    link &&
    dailyShareText({
      history,
      total,
      day,
      score,
      place: daily.offBoard ? null : { rank: daily.rank, of: daily.total },
      streak: daily.streak,
      link,
    });
  const madeToday = !!me && dayKey(me.createdAt) === day;
  const runs = daily.offBoard ? daily.total + 1 : daily.total;
  return (
    <Card accent={colors.gold}>
      {placeShown(runs) ? (
        <>
          <Heading title={daily.offBoard ? 'Щеше да си' : 'Твоето място днес'} />
          <T variant="hero" style={{ color: colors.gold }}>
            #{daily.rank} <T tone="fg2">от {fmt(runs)} днес</T>
          </T>
        </>
      ) : (
        <>
          <Heading title="Днешната класация" />
          <T tone="fg2">
            Засега го {runs === 1 ? 'изигра' : 'изиграха'} {plural(runs, 'човек', 'души')}: мястото ти се вижда, щом
            станат поне {DAILY_FIELD.placeFrom}.
          </T>
        </>
      )}
      {daily.offBoard && (
        <T variant="small" tone="fg2">
          {offBoardWhy({ guest: !!me?.isGuest, madeToday, moreTime: daily.moreTime })}
        </T>
      )}
      {daily.field && <DayField field={daily.field} correct={correct} />}
      {daily.sharer && <AgainstSharer sharer={daily.sharer} score={score} correct={correct} of={total} />}
      {daily.streak > 0 && (
        <T variant="small" style={{ color: '#fdba74', fontFamily: fonts.bold }}>
          🔥 Серия {plural(daily.streak, 'ден', 'дни')}
        </T>
      )}
      {daily.shieldsUsed > 0 && (
        <T variant="small" tone="fg2">
          🛡️{' '}
          {daily.shieldsUsed === 1
            ? 'Щит спаси серията ти: пропуснатият ден не я прекъсна.'
            : `${daily.shieldsUsed} щита спасиха серията ти: пропуснатите дни не я прекъснаха.`}
        </T>
      )}
      {daily.shieldEarned && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            padding: 12,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: '#7dd3fc55',
            backgroundColor: '#38bdf81f',
          }}
        >
          <T style={{ fontSize: 28, lineHeight: 34 }}>🛡️</T>
          <T variant="small" style={{ flex: 1 }}>
            <T variant="small" style={{ fontFamily: fonts.bold }}>
              Имаш нов щит!
            </T>{' '}
            Ако пропуснеш ден, той ще запази серията.
          </T>
        </View>
      )}
      <T variant="caption" tone="fg3">
        Класацията се променя, докато другите играят — до полунощ.
      </T>
      <Button
        title="Прати днешните въпроси"
        disabled={!text}
        onPress={() => text && void Share.share({ message: text })}
      />
      <T variant="caption" tone="fg3">
        Който отвори линка, играе същите 10 — и после виждаш как са се справили.
      </T>
    </Card>
  );
}

const people = (n: number) => `${fmt(n)} ${n === 1 ? 'човек' : 'души'}`;

/** How the day went for everyone: „По-добър от 73% днес“, and how many got each number right, yours marked. */
export function DayField({ field, correct }: { field: DailyField; correct: number }) {
  const colors = useColors();
  const max = Math.max(1, ...field.histogram);
  // One per number of right answers, 0 to all of them.
  const columns = [...field.histogram.keys()];
  const total = field.histogram.reduce((a, b) => a + b, 0);
  const said = field.histogram.map((n, i) => `${i} верни: ${people(n)}`).join(', ');
  return (
    <View style={{ gap: 6 }}>
      <T variant="bodyStrong">
        {field.beaten >= 0.995 ? 'Най-добрият резултат днес!' : `По-добър от ${percent(field.beaten)} днес`}
      </T>
      <View
        accessible
        accessibilityLabel={`Колко верни отговора имаха играчите днес, от ${people(total)}: ${said}. Ти: ${correct}.`}
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 72 }}
      >
        {columns.map((i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            {i === correct && (
              <T variant="caption" style={{ fontSize: 10, lineHeight: 12, fontFamily: fonts.bold }}>
                ти
              </T>
            )}
            <View
              style={{
                width: '100%',
                maxWidth: 22,
                height: Math.max(2, Math.round(((field.histogram[i] ?? 0) / max) * 56)),
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor: i === correct ? '#fcd34d' : '#6b6588',
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 3, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 2 }}>
        {columns.map((i) => (
          <T
            key={i}
            variant="caption"
            tone={i === correct ? 'fg' : 'fg3'}
            align="center"
            style={{ flex: 1, fontSize: 11 }}
          >
            {i}
          </T>
        ))}
      </View>
    </View>
  );
}

/** The friend whose link this was: their day against yours. */
function AgainstSharer({
  sharer,
  score,
  correct,
  of,
}: {
  sharer: DailySharer;
  score: number;
  correct: number;
  of: number;
}) {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const verdict =
    score > sharer.score ? 'Ти водиш!' : score < sharer.score ? `${sharer.user.username} води` : 'Равни сте';
  const line = (who: { avatar: string; frame: string }, name: string, c: number, sc: number, you = false) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Avatar avatar={who.avatar} frame={who.frame} size={28} />
      <T variant="small" tone={you ? 'link' : 'fg'} style={{ flex: 1, fontFamily: fonts.semibold }} numberOfLines={1}>
        {name}
      </T>
      <T variant="small" tone="fg2" style={{ fontVariant: ['tabular-nums'] }}>
        {c}/{of} · {fmt(sc)} т.
      </T>
    </View>
  );
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
      <T variant="label" tone="fg3">
        По линка на {sharer.user.username}
      </T>
      {line(sharer.user, sharer.user.username, sharer.correct, sharer.score)}
      {me && line(me, 'Ти', correct, score, true)}
      <T variant="title" tone="gold">
        {verdict}
      </T>
    </View>
  );
}

/** Lines shown before „още“: the biggest ones; the rest is a tap away. */
const SHOWN_LINES = 3;

/** The XP, the level it brought you to and how far into it, and what the XP was for (largest first). */
export function RewardsCard({ rewards }: { rewards: MatchRewards }) {
  const [all, setAll] = useState(false);
  const breakdown = [...rewards.breakdown].sort((a, b) => b.amount - a.amount);
  const folded = !all && breakdown.length > SHOWN_LINES + 1;
  const lines = folded ? breakdown.slice(0, SHOWN_LINES) : breakdown;
  const p = levelProgress(rewards.xpAfter);
  const leveled = rewards.levelAfter > rewards.levelBefore;
  const colors = useColors();
  return (
    <Card accent={colors.violet}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <Heading title="Награди" />
        <T variant="h1" tone="link">
          +{fmt(rewards.xpGained)} XP
        </T>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T variant="bodyStrong">Ниво {p.level}</T>
        <T variant="small" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
          {fmt(p.into)} / {fmt(p.needed)}
        </T>
      </View>
      <Progress
        value={p.pct}
        height={10}
        label={`Ниво ${p.level}`}
        valueText={`${fmt(p.into)} от ${fmt(p.needed)} XP до следващото`}
      />
      {leveled && (
        <IconText icon="⬆️" variant="title" align="center" containerStyle={{ paddingVertical: 6 }}>
          Ново ниво {rewards.levelAfter}!
        </IconText>
      )}
      <View style={{ gap: 6 }}>
        {lines.map((line) => (
          <View key={line.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <T variant="small" tone="fg2" style={{ flex: 1 }}>
              {line.label}
            </T>
            <T variant="small" style={{ fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] }}>
              +{fmt(line.amount)}
            </T>
          </View>
        ))}
      </View>
      {folded && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAll(true)}
          style={{ minHeight: 40, justifyContent: 'center' }}
        >
          <T variant="small" tone="link" style={{ fontFamily: fonts.semibold }}>
            + още {breakdown.length - SHOWN_LINES} {breakdown.length - SHOWN_LINES === 1 ? 'ред' : 'реда'}
          </T>
        </Pressable>
      )}
    </Card>
  );
}

/** The rating change in a word, for the headline (the card below has the rank). */
export function RatingChip({ rating }: { rating: { before: number; after: number } }) {
  const delta = rating.after - rating.before;
  return (
    <Chip
      tone={delta >= 0 ? 'good' : 'bad'}
      text={`Рейтинг ${fmt(rating.after)} (${delta >= 0 ? `+${delta}` : `−${-delta}`})`}
    />
  );
}

/** A rounded line under the headline: what changed (the rating, the record, the XP). */
export function Chip({ text, tone = 'fg2' }: { text: string; tone?: 'good' | 'bad' | 'gold' | 'link' | 'fg2' }) {
  const colors = useColors();
  const color = tone === 'fg2' ? colors.fg2 : colors[tone];
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: `${color}22` }}>
      <T variant="small" tone={tone} style={{ fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] }}>
        {text}
      </T>
    </View>
  );
}

export function AchievementsCard({ ids }: { ids: string[] }) {
  return (
    <Card>
      <Heading title="Нови постижения" />
      {ids.map((id) => {
        const a = achievementById(id);
        if (!a) return null;
        const rarity = RARITIES[a.rarity];
        return (
          <View
            key={id}
            accessible
            accessibilityLabel={`${a.name}: ${sentences(a.description, `${rarity.name}, +${a.xp} XP`)}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: `${rarity.color}55`,
              backgroundColor: `${rarity.color}14`,
            }}
          >
            <T style={{ fontSize: 28, lineHeight: 34 }}>{a.icon}</T>
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{a.name}</T>
              <T variant="caption" tone="fg3">
                {a.description}
              </T>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T variant="caption" style={{ fontFamily: fonts.bold }}>
                {rarity.name}
              </T>
              <T variant="caption" tone="fg3">
                +{a.xp} XP
              </T>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

/** Category mastery this match earned: a tier in a category, and its title to wear. */
export function MasteryCard({ mastery }: { mastery: CategoryMastery[] }) {
  return (
    <Card>
      <Heading title="Майсторство" />
      {mastery.map((earned) => {
        const tier = MASTERY_TIERS[earned.tier];
        const category = categoryById(earned.category);
        return (
          <View key={earned.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <T style={{ fontSize: 36, lineHeight: 44 }}>{tier?.icon}</T>
            <View style={{ flex: 1 }}>
              <T variant="title">{masteryName(earned)}</T>
              <IconText icon={category?.icon} variant="small" tone="fg2">
                Нова степен — и титла, която можеш да носиш.
              </IconText>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

/** Wears a new avatar or frame at once (as the collection does): idle, saving, or worn. */
export function useWear(unlock: { kind: 'avatar' | 'frame'; id: string } | null) {
  const me = useStore((s) => s.me);
  const [state, setWear] = useState<'idle' | 'saving' | 'worn'>('idle');
  const worn =
    !!unlock && (state === 'worn' || (unlock.kind === 'avatar' ? me?.avatar === unlock.id : me?.frame === unlock.id));
  const wear = async () => {
    if (!unlock) return;
    setWear('saving');
    try {
      const { user } = await api.loadout({ [unlock.kind]: unlock.id });
      setState({ me: user });
      setWear('worn');
    } catch (err) {
      setWear('idle');
      toast({ kind: 'error', title: errorMessage(err, 'Неуспешно запазване.') });
    }
  };
  return { worn, saving: state === 'saving', wear };
}

/** A new avatar or frame, big, on you, with „Сложи го“ to wear it at once. The rest of what came is in UnlocksCard. */
export function UnlockReveal({ rewards }: { rewards: MatchRewards }) {
  const me = useStore((s) => s.me);
  const found = rewards.unlocks.find((u) => u.kind === 'avatar' || u.kind === 'frame');
  const unlock = found ? { kind: found.kind as 'avatar' | 'frame', id: found.id } : null;
  const { worn, saving, wear } = useWear(unlock);
  if (!unlock || !found || !me) return null;
  const { name } = unlockPreview(found);
  // „го“ for an avatar, „я“ for a frame (рамка).
  const it = unlock.kind === 'avatar' ? 'го' : 'я';
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <Avatar
        avatar={unlock.kind === 'avatar' ? unlock.id : me.avatar}
        frame={unlock.kind === 'frame' ? unlock.id : me.frame}
        size={72}
      />
      <View style={{ flex: 1, gap: 6 }}>
        <T variant="label" tone="gold">
          Ново за теб
        </T>
        <T variant="title">{name}</T>
        {worn ? (
          <T variant="small" tone="good" style={{ fontFamily: fonts.semibold }}>
            ✓ Носиш {it}
          </T>
        ) : (
          <Button
            title={`Сложи ${it}`}
            loading={saving}
            onPress={() => void wear()}
            style={{ alignSelf: 'flex-start' }}
          />
        )}
      </View>
    </Card>
  );
}

export function UnlocksCard({ rewards }: { rewards: MatchRewards }) {
  const colors = useColors();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <Heading title="Отключено" />
        <Pressable accessibilityRole="link" onPress={() => router.push('/locker')} hitSlop={8}>
          <T variant="small" tone="link" style={{ fontFamily: fonts.semibold }}>
            Към колекцията →
          </T>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {rewards.unlocks.map((u) => {
          const { icon, name } = unlockPreview(u);
          return (
            <View
              key={`${u.kind}:${u.id}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.glass,
              }}
            >
              <T>{icon}</T>
              <T variant="small">{name}</T>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** A ranked match that left the rating as it was, and why (instead of a puzzling „+0“). */
const UNRATED: Record<Exclude<UnratedReason, 'no_contest' | 'guest'>, string> = {
  pair: `Двамата вече изиграхте ${RATED_GAMES_PER_PAIR} мача с рейтинг днес — до утре мачовете ви са без рейтинг.`,
  cut: 'Мачът приключи по-рано заради нас (обновяване или грешка), затова не променя рейтинга.',
  new: `Профилът ти е нов: срещу хора рейтингът започва, когато профилът е на поне ден и има ${RATED_AFTER.games} мача. Срещу ботове се брои от първия мач.`,
  new_rival: `Съперникът играе с нов профил: мачът е без рейтинг, докато профилът му не е на поне ден и няма ${RATED_AFTER.games} мача.`,
};

export function UnratedCard({ reason, guest }: { reason: Exclude<UnratedReason, 'no_contest'>; guest: boolean }) {
  return (
    <Card>
      <Heading title="Рейтинг" />
      <T variant="small" tone="fg2">
        {reason !== 'guest'
          ? UNRATED[reason]
          : guest
            ? 'Като гост играеш срещу хора без рейтинг (срещу ботове — с рейтинг). Запази профила си, за да се класираш.'
            : 'Мачовете срещу гости са без рейтинг.'}
      </T>
    </Card>
  );
}

export function RatingCard({ rating }: { rating: { before: number; after: number } }) {
  const colors = useColors();
  const delta = rating.after - rating.before;
  const promoted = rankFor(rating.after).id !== rankFor(rating.before).id && delta > 0;
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ gap: 6 }}>
        <Heading title="Рейтинг" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <RankBadge rating={rating.after} />
          {promoted && (
            <T variant="small" tone="gold" style={{ fontFamily: fonts.bold }}>
              Нов ранг!
            </T>
          )}
        </View>
      </View>
      <T variant="hero" style={{ color: delta >= 0 ? colors.good : colors.bad, fontVariant: ['tabular-nums'] }}>
        {delta >= 0 ? '+' : ''}
        {delta}
      </T>
    </Card>
  );
}

/** How many facts the results show up front (the rest are in the questions below). */
const SHOWN_FACTS = 3;

/**
 * „Днес научи“: a few „Знаеше ли?“ facts from the match, the ones behind the questions missed first — that's when „so
 * that's why“ lands best. `added`: how many went into „Моите знания“.
 */
export function LearnedToday({ items, added }: { items: ReviewItem[]; added: number }) {
  const withFacts = items.filter((i) => i.fact);
  if (!withFacts.length) return null;
  const shown = [...withFacts.filter((i) => !i.right), ...withFacts.filter((i) => i.right)].slice(0, SHOWN_FACTS);
  return (
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
        <Heading title="💡 Днес научи" />
        {added > 0 && (
          <Pressable accessibilityRole="link" onPress={() => router.navigate('/knowledge')} hitSlop={6}>
            <T variant="small" tone="good" style={{ fontFamily: fonts.semibold }}>
              📖 +{added} в „Моите знания“
            </T>
          </Pressable>
        )}
      </View>
      {shown.map((item) => (
        <View key={item.id} style={{ gap: 4 }}>
          <T variant="caption" tone="fg3">
            {keepTogether(item.q)} —{' '}
            <T variant="caption" tone="good" style={{ fontFamily: fonts.semibold }}>
              {item.number
                ? numberText(item.number.answer, item.number)
                : item.order
                  ? item.order.right.map((i) => keepTogether(item.order!.items[i] ?? '')).join(' → ')
                  : keepTogether(item.options[item.correct] ?? '')}
            </T>
          </T>
          <T>{keepTogether(item.fact ?? '')}</T>
        </View>
      ))}
      {withFacts.length > SHOWN_FACTS && (
        <T variant="caption" tone="fg3">
          Още {withFacts.length - SHOWN_FACTS} — във въпросите по-долу.
        </T>
      )}
    </Card>
  );
}

/** A guest's results: what keeps them, once they've seen what there is to keep. */
export function GuestNudge({ xp }: { xp: number | null }) {
  const colors = useColors();
  return (
    <Card accent={colors.violet}>
      <T variant="small" tone="fg2">
        {xp !== null
          ? `Запази тези ${fmt(xp)} XP: с име и парола нивото, серията и всичко изиграно остават твои — на всяко устройство.`
          : 'С име и парола нивото, серията и всичко изиграно остават твои — на всяко устройство.'}
      </T>
      <Button title="Запази профила" variant="secondary" onPress={() => router.push('/settings')} />
    </Card>
  );
}
