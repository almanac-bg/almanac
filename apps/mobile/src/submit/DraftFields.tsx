import { type DraftErrors, LETTERS } from '@almanac/client';
import { CATEGORIES, type CategoryId, type Difficulty, type QuestionDraft, SUBMISSION_RULES } from '@almanac/shared';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Field, T } from '@/ui';
import { Choices } from '@/ui/controls';

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Лесен' },
  { id: 'medium', label: 'Среден' },
  { id: 'hard', label: 'Труден' },
];

function Label({ text, hint, error }: { text: string; hint?: string; error?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <T variant="label" tone="fg2">
        {text}
      </T>
      {hint ? (
        <T variant="caption" tone="fg3">
          {hint}
        </T>
      ) : null}
      {error ? (
        <T
          variant="caption"
          tone="bad"
          role="alert"
          accessibilityLiveRegion="polite"
          style={{ fontFamily: fonts.semibold }}
        >
          {error}
        </T>
      ) : null}
    </View>
  );
}

/**
 * A question for the bank as its author writes it (the web's DraftEditor): its category and difficulty, the question,
 * four options with the right one marked, where the answer can be checked, and a „Знаеше ли?“ with its source if they
 * like. `errors`: what's wrong, under each part, once the author tried to send it.
 */
export function DraftFields({
  draft,
  onChange,
  errors,
}: {
  draft: QuestionDraft;
  onChange: (d: QuestionDraft) => void;
  errors: DraftErrors;
}) {
  const colors = useColors();
  const set = (patch: Partial<QuestionDraft>) => onChange({ ...draft, ...patch });
  const [fMin, fMax] = SUBMISSION_RULES.fact;
  const box = (marked = false, bad = false) => ({
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: bad ? colors.bad : marked ? `${colors.good}88` : colors.lineStrong,
    backgroundColor: colors.ink2,
    color: colors.fg,
    fontFamily: fonts.regular,
    fontSize: 16,
  });
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Label text="Категория" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Choices<CategoryId>
            label="Категория"
            options={CATEGORIES.map((c) => ({ id: c.id, label: `${c.icon} ${c.name}` }))}
            value={draft.category}
            onChange={(category) => set({ category })}
          />
        </ScrollView>
      </View>
      <View style={{ gap: 8 }}>
        <Label text="Трудност" />
        <Choices<Difficulty>
          label="Трудност"
          options={DIFFICULTIES}
          value={draft.difficulty}
          onChange={(difficulty) => set({ difficulty })}
        />
      </View>
      <View style={{ gap: 8 }}>
        <Label text="Въпрос" error={errors.q} />
        <TextInput
          value={draft.q}
          multiline
          maxLength={SUBMISSION_RULES.question[1]}
          accessibilityLabel="Въпрос"
          placeholder="напр. Кой е най-високият връх на Балканския полуостров?"
          placeholderTextColor={colors.fg3}
          onChangeText={(q) => set({ q })}
          style={[box(false, !!errors.q), { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' }]}
        />
      </View>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Отговори — отбележи верния">
        <Label text="Отговори — отбележи верния" error={errors.options ?? errors.answer} />
        {draft.options.map((o, i) => (
          <View key={LETTERS[i]} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.answer === i }}
              accessibilityLabel={`${LETTERS[i]} е верният`}
              onPress={() => set({ answer: i })}
              hitSlop={4}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: draft.answer === i ? colors.good : colors.lineStrong,
                backgroundColor: draft.answer === i ? `${colors.good}22` : 'transparent',
              }}
            >
              <T style={{ fontFamily: fonts.bold, color: draft.answer === i ? colors.good : colors.fg3 }}>
                {draft.answer === i ? '✓' : LETTERS[i]}
              </T>
            </Pressable>
            <TextInput
              value={o}
              maxLength={SUBMISSION_RULES.option[1]}
              accessibilityLabel={`Отговор ${LETTERS[i]}`}
              placeholder={`Отговор ${LETTERS[i]}`}
              placeholderTextColor={colors.fg3}
              onChangeText={(text) => set({ options: draft.options.map((x, j) => (j === i ? text : x)) })}
              style={[box(draft.answer === i), { flex: 1 }]}
            />
          </View>
        ))}
      </View>
      <View style={{ gap: 8 }}>
        <Label
          text="Източник на верния отговор"
          hint="Страница, на която модераторът да го провери: Уикипедия, официален сайт, енциклопедия."
          error={errors.answerSource}
        />
        <TextInput
          value={draft.answerSource ?? ''}
          accessibilityLabel="Източник на верния отговор"
          placeholder="https://bg.wikipedia.org/wiki/…"
          placeholderTextColor={colors.fg3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={(answerSource) => set({ answerSource })}
          style={box(false, !!errors.answerSource)}
        />
      </View>
      <View style={{ gap: 8 }}>
        <Label
          text="„Знаеше ли?“ — по желание"
          hint={`Нещо вярно и изненадващо за отговора, което играчите да научат: ${fMin}–${fMax} знака, с източник.`}
          error={errors.fact}
        />
        <TextInput
          value={draft.fact ?? ''}
          multiline
          maxLength={fMax}
          accessibilityLabel="„Знаеше ли?“"
          placeholderTextColor={colors.fg3}
          onChangeText={(fact) => set({ fact })}
          style={[box(false, !!errors.fact), { minHeight: 72, paddingTop: 12, textAlignVertical: 'top' }]}
        />
        <Field
          label="Източник на факта"
          value={draft.factSource ?? ''}
          placeholder="https://…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={(factSource) => set({ factSource })}
          error={errors.factSource}
        />
      </View>
    </View>
  );
}
