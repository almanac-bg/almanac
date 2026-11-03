import {
  api,
  fmt,
  keepTogether,
  LETTERS,
  numberText,
  offText,
  orderValueText,
  percent,
  type ReviewItem,
} from '@almanac/client';
import { categoryById, QUESTION_REPORT_REASONS, type ReportReason } from '@almanac/shared';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Picture } from '@/components/Picture';
import { ReportSheet, reasonsFor } from '@/components/ReportSheet';
import { fonts, radius, useColors } from '@/theme';
import { Card, T } from '@/ui';

/** A question from a room host's own set („Моите въпроси“), not the bank. */
const ownQuestion = (item: ReviewItem) => item.id.startsWith('set-');

/**
 * The match's questions with the right answers (the web's QuestionReview), folded until opened, and a way to flag a
 * mistake in any of them — or, for a room that played its host's own set (`set`), to report the set: a mistake in it is
 * the host's to fix, what mustn't be in it a moderator's.
 */
export function QuestionReview({
  items,
  set = null,
}: {
  items: ReviewItem[];
  set?: { gameId: string; name: string } | null;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState<ReviewItem | null>(null);
  const [reportingSet, setReportingSet] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const right = items.filter((i) => i.right).length;
  return (
    <Card style={{ gap: 0, padding: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Преглед на въпросите, ${right} от ${items.length} верни`}
        onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18 }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="h2" role="heading">
            Преглед на въпросите
          </T>
          <T variant="small" tone="fg3">
            {right} от {items.length} верни
            {set ? '' : ' · видя ли грешка във въпрос? Сигнализирай с 🚩'}
          </T>
        </View>
        <T tone="fg3">{open ? '▴' : '▾'}</T>
      </Pressable>
      {set && (
        <View style={{ paddingHorizontal: 18, paddingBottom: 14, gap: 6 }}>
          <T variant="small" tone="fg3">
            Въпросите са от набора на домакина „{set.name}“. Нещо обидно или незаконно в тях?
          </T>
          <Pressable accessibilityRole="button" onPress={() => setReportingSet(true)} hitSlop={6}>
            <T variant="small" tone="gold" style={{ fontFamily: fonts.semibold, textDecorationLine: 'underline' }}>
              🚩 Сигнал за набора
            </T>
          </Pressable>
        </View>
      )}
      {open &&
        items.map((item) => (
          <View key={item.index} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
            <Row
              item={item}
              reported={reported.has(item.id)}
              // A host's own question isn't the bank's to fix.
              onReport={ownQuestion(item) ? null : () => setReporting(item)}
            />
          </View>
        ))}
      <ReportSheet
        open={!!reporting}
        onClose={() => setReporting(null)}
        title="Сигнализирай за грешка"
        context={reporting ? keepTogether(reporting.q) : undefined}
        // The fact is a reason only where there is one.
        reasons={QUESTION_REPORT_REASONS.filter((r) => r.id !== 'fact' || reporting?.fact)}
        placeholder="Какъв е верният отговор или какво не е наред? (по желание)"
        thanks="Модератор ще прегледа въпроса."
        send={async (reason, details) => {
          if (!reporting) return;
          await api.reportQuestion(reporting.id, reason, details);
          setReported((s) => new Set(s).add(reporting.id));
        }}
      />
      {set && (
        <ReportSheet<ReportReason>
          open={reportingSet}
          onClose={() => setReportingSet(false)}
          title={`Сигнал за набора „${set.name}“`}
          reasons={reasonsFor('set')}
          send={(reason, details) => api.reportPlayedSet(set.gameId, reason, details)}
        />
      )}
    </Card>
  );
}

function Row({ item, reported, onReport }: { item: ReviewItem; reported: boolean; onReport: (() => void) | null }) {
  const colors = useColors();
  const category = categoryById(item.category);
  return (
    <View style={{ flexDirection: 'row', gap: 12, padding: 16 }}>
      <View
        accessible
        accessibilityLabel={item.right ? 'Верен отговор' : 'Грешен отговор'}
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: item.right ? `${colors.good}26` : `${colors.bad}26`,
        }}
      >
        <T variant="small" tone={item.right ? 'good' : 'bad'} style={{ fontFamily: fonts.bold }}>
          {item.right ? '✓' : '✕'}
        </T>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <T variant="caption" tone="fg3">
          {item.index + 1}.{' '}
          {ownQuestion(item) ? '📝 От набора на домакина' : `${category?.icon ?? ''} ${category?.name ?? ''}`}
        </T>
        <T variant="bodyStrong">{keepTogether(item.q)}</T>
        {item.image && <Picture image={item.image} credit={item.image.credit} maxHeight={150} />}
        <Answer item={item} />
        {item.fact && (
          <T variant="small" tone="fg2">
            💡 {keepTogether(item.fact)}
          </T>
        )}
      </View>
      {onReport && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            reported ? 'Сигнализирано — благодарим!' : `Сигнализирай за грешка във въпрос ${item.index + 1}`
          }
          accessibilityState={{ disabled: reported }}
          disabled={reported}
          onPress={onReport}
          hitSlop={6}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            marginTop: -6,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? colors.lineStrong : 'transparent',
            opacity: reported ? 1 : 0.7,
          })}
        >
          <T>{reported ? '🚩' : '⚑'}</T>
        </Pressable>
      )}
    </View>
  );
}

/** The right answer, yours, and how everyone answered — an order, a number or the options with their shares. */
function Answer({ item }: { item: ReviewItem }) {
  const colors = useColors();
  if (item.order) {
    const { order } = item;
    return (
      <View style={{ gap: 2 }}>
        {order.right.map((i, place) => {
          const placed = order.given?.[place] === i;
          return (
            <T key={order.items[i] ?? i} variant="small" tone={placed ? 'good' : 'fg2'}>
              {place + 1}. {keepTogether(order.items[i] ?? '')}
              {order.values && order.values[i] !== undefined ? ` · ${orderValueText(order.values[i], order.unit)}` : ''}
              {placed ? ' ✓' : ''}
            </T>
          );
        })}
        <T variant="small" tone={item.right ? 'fg2' : 'bad'}>
          {order.given === null
            ? 'Без отговор'
            : item.right
              ? 'Ти: всичко на място'
              : `Ти: ${order.placed} от ${order.items.length} на място`}
        </T>
        {item.crowd && (
          <T variant="caption" tone="fg3">
            {percent(item.crowd.known)} от всички подредиха всичко (от {fmt(item.crowd.answers)} отговора)
          </T>
        )}
      </View>
    );
  }
  if (item.number) {
    const n = item.number;
    return (
      <View style={{ gap: 2 }}>
        <T variant="small" tone="good">
          ✓ {numberText(n.answer, n)}
        </T>
        <T variant="small" tone={item.right ? 'fg2' : 'bad'}>
          {n.guess === null ? 'Без отговор' : `Ти: ${numberText(n.guess, n)} (${offText(n.guess, n.answer, n)})`}
        </T>
        {item.crowd && (
          <T variant="caption" tone="fg3">
            {percent(item.crowd.known)} от всички бяха близо (от {fmt(item.crowd.answers)} отговора)
          </T>
        )}
      </View>
    );
  }
  const yours = item.choice !== null && item.choice >= 0 ? item.choice : null;
  const picks = item.crowd?.picks;
  if (picks) {
    return (
      <View style={{ gap: 4 }}>
        {item.options.map((text, i) => {
          const right = i === item.correct;
          const mine = i === yours;
          const share = picks[i] ?? 0;
          return (
            <View
              key={LETTERS[i]}
              accessible
              accessibilityLabel={`${LETTERS[i]}) ${text}${right ? ', верният' : ''}${mine ? ', твоят' : ''}: ${percent(share)}`}
              style={{ borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.glass }}
            >
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${Math.round(share * 100)}%`,
                  backgroundColor: right ? `${colors.good}33` : mine ? `${colors.bad}33` : colors.line,
                }}
              />
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: 10,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                }}
              >
                <T
                  variant="small"
                  tone={right ? 'good' : mine ? 'bad' : 'fg2'}
                  style={{ flex: 1, fontFamily: right ? fonts.semibold : fonts.medium }}
                >
                  {right ? '✓ ' : ''}
                  {LETTERS[i]}) {keepTogether(text)}
                  {mine ? ' · ти' : ''}
                </T>
                <T variant="small" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
                  {percent(share)}
                </T>
              </View>
            </View>
          );
        })}
        <T variant="caption" tone="fg3">
          {yours === null && !item.right ? 'Без отговор · ' : ''}Как отговориха всички (от{' '}
          {fmt(item.crowd?.answers ?? 0)} отговора)
        </T>
      </View>
    );
  }
  return (
    <View style={{ gap: 2 }}>
      <T variant="small" tone="good">
        ✓ {LETTERS[item.correct]}) {keepTogether(item.options[item.correct] ?? '')}
      </T>
      {!item.right && (
        <T variant="small" tone="bad">
          {yours === null ? 'Без отговор' : `Ти: ${LETTERS[yours]}) ${keepTogether(item.options[yours] ?? '')}`}
        </T>
      )}
    </View>
  );
}
