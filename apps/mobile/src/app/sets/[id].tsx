import {
  api,
  blankDraft,
  defaultTolerance,
  draftContent,
  errorMessage,
  LETTERS,
  type SetDraft,
  switchKind,
  toast,
  toDraft,
  toSetBody,
} from '@almanac/client';
import { SETS, type SetImage } from '@almanac/shared';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams, useNavigation, usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '@/lib/client';
import { useLoad } from '@/lib/load';
import { pickSetPicture } from '@/lib/pictures';
import { playInRoom, setPictureUri } from '@/sets/parts';
import { fonts, gutter, radius, useColors } from '@/theme';
import { Button, Card, COLUMN, Field, LoadError, T, usePagePadding } from '@/ui';
import { Choices } from '@/ui/controls';

/**
 * A set of your own (the web's SetEditor): its name and up to fifty questions — four options, true or false, a number,
 * or „Подреди“ — each moved up or down, with a picture for the first two kinds. The save stays at the bottom; leaving
 * with unsaved changes asks first.
 */
export default function SetEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const setId = Number(id);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const padding = usePagePadding();
  const navigation = useNavigation();
  const { data, error, status, reload } = useLoad(() => api.set(setId), id);
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<SetDraft[]>([]);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setDrafts(data.questions.map(toDraft));
    setSaved(draftContent(data.name, data.questions.map(toDraft)));
  }, [data]);
  const dirty = !!data && draftContent(name, drafts) !== saved;

  // Unsaved work isn't lost to a swipe back without a word.
  usePreventRemove(dirty, ({ data: { action } }) =>
    Alert.alert('Да излезеш ли, без да запазиш?', 'Промените в набора ще се загубят.', [
      { text: 'Остани', style: 'cancel' },
      { text: 'Излез', style: 'destructive', onPress: () => navigation.dispatch(action) },
    ]),
  );

  const update = (i: number, next: SetDraft) => setDrafts((ds) => ds.map((d, j) => (j === i ? next : d)));
  const move = (i: number, by: number) =>
    setDrafts((ds) => {
      const next = [...ds];
      const [a, b] = [next[i], next[i + by]];
      if (!a || !b) return ds;
      next[i] = b;
      next[i + by] = a;
      return next;
    });

  const save = async () => {
    const built = toSetBody(name, drafts);
    if ('error' in built) return setProblem(built.error);
    setBusy(true);
    try {
      const set = await api.saveSet(setId, built.body);
      setName(set.name);
      setDrafts(set.questions.map(toDraft));
      setSaved(draftContent(set.name, set.questions.map(toDraft)));
      setProblem(null);
      toast({ kind: 'success', title: 'Наборът е запазен' });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = () =>
    Alert.alert(
      'Изтриване на набора',
      `Наборът „${data?.name ?? ''}“ ще изчезне. Копията, които други са взели, остават техни.`,
      [
        { text: 'Не', style: 'cancel' },
        {
          text: 'Изтрий',
          style: 'destructive',
          onPress: () =>
            void api.deleteSet(setId).then(
              () => {
                setSaved(draftContent(name, drafts));
                router.replace('/sets');
              },
              (err: unknown) => toast({ kind: 'error', title: errorMessage(err) }),
            ),
        },
      ],
    );

  if (!data && error)
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, padding: gutter, justifyContent: 'center' }}>
        {status === 404 ? (
          <T variant="title" align="center">
            Няма такъв набор
          </T>
        ) : (
          <LoadError title="Наборът не се зареди" error={error} onRetry={reload} />
        )}
      </View>
    );
  if (!data) return <ActivityIndicator style={{ marginTop: 80 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <Stack.Screen options={{ title: data.name }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[padding, { paddingBottom: 24 }]}>
        <View style={[COLUMN, { gap: 14 }]}>
          {data.hidden && (
            <Card accent={colors.bad}>
              <T variant="small" tone="bad">
                Модератор скри този набор след сигнал: не може да се играе и споделя.
              </T>
            </Card>
          )}
          <Field label="Име на набора" value={name} maxLength={SETS.name[1]} onChangeText={setName} />
          {drafts.map((d, i) => (
            <QuestionCard
              key={d.key}
              index={i}
              draft={d}
              last={i === drafts.length - 1}
              onChange={(next) => update(i, next)}
              onMove={(by) => move(i, by)}
              onRemove={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
            />
          ))}
          <Button
            title={`+ Въпрос ${drafts.length < SETS.maxQuestions ? drafts.length + 1 : ''}`}
            variant="secondary"
            disabled={drafts.length >= SETS.maxQuestions}
            onPress={() => setDrafts((ds) => [...ds, blankDraft()])}
          />
          <View style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }}>
            {/* The saved set, in a room; unsaved changes wouldn't be in it, so save first. */}
            <Button
              title="Пусни в стая"
              variant="secondary"
              disabled={dirty || data.hidden || !data.questions.length}
              hint={dirty ? 'Запази промените първо' : undefined}
              onPress={() => void playInRoom(setId)}
            />
            <Button
              title="Сподели с друг домакин"
              variant="ghost"
              disabled={data.hidden}
              onPress={() =>
                void Share.share({
                  message: `Набор с въпроси „${data.name}“ — вземи копие за стаите си:\n${API_URL}/sets/shared/${data.code}`,
                })
              }
            />
            <Button title="Изтрий набора" variant="ghost" onPress={remove} />
          </View>
        </View>
      </ScrollView>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          paddingLeft: insets.left + gutter,
          paddingRight: insets.right + gutter,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          backgroundColor: colors.ink2,
        }}
      >
        <T variant="small" tone={problem ? 'bad' : 'fg3'} style={{ flex: 1 }} accessibilityLiveRegion="polite">
          {problem ??
            (dirty ? 'Има незапазени промени.' : `${drafts.length} от ${SETS.maxQuestions} въпроса · запазено`)}
        </T>
        <Button title="Запази" loading={busy} disabled={!dirty} onPress={() => void save()} />
      </View>
    </View>
  );
}

function QuestionCard({
  index,
  draft: d,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  draft: SetDraft;
  last: boolean;
  onChange: (d: SetDraft) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const n = index + 1;
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <T variant="title" role="heading" style={{ flex: 1 }}>
          Въпрос {n}
        </T>
        <IconButton label={`Въпрос ${n} по-нагоре`} icon="↑" disabled={index === 0} onPress={() => onMove(-1)} />
        <IconButton label={`Въпрос ${n} по-надолу`} icon="↓" disabled={last} onPress={() => onMove(1)} />
        <IconButton label={`Махни въпрос ${n}`} icon="✕" onPress={onRemove} />
      </View>
      <Choices<SetDraft['kind']>
        label={`Вид на въпрос ${n}`}
        options={[
          { id: 'choice', label: '4 отговора' },
          { id: 'truefalse', label: 'Вярно/невярно' },
          { id: 'number', label: 'Число' },
          { id: 'order', label: 'Подреди' },
        ]}
        value={d.kind}
        onChange={(k) => onChange(switchKind(d, k))}
      />
      <TextInput
        value={d.q}
        multiline
        maxLength={SETS.question[1]}
        accessibilityLabel={`Текст на въпрос ${n}`}
        placeholder={
          d.kind === 'truefalse'
            ? 'Твърдение, напр. „Дунав се влива в Черно море.“'
            : d.kind === 'order'
              ? 'Напр. „Подреди от най-ранното към най-късното:“'
              : 'Въпросът'
        }
        placeholderTextColor={colors.fg3}
        onChangeText={(q) => onChange({ ...d, q })}
        style={{
          minHeight: 72,
          padding: 12,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.lineStrong,
          backgroundColor: colors.ink2,
          color: colors.fg,
          fontFamily: fonts.regular,
          fontSize: 16,
          textAlignVertical: 'top',
        }}
      />
      {(d.kind === 'choice' || d.kind === 'truefalse') && (
        <PictureField index={index} image={d.image} onChange={(image) => onChange({ ...d, image })} />
      )}
      {d.kind === 'choice' && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Отговори; отбележи верния" style={{ gap: 8 }}>
          {d.options.map((o, i) => (
            <View key={LETTERS[i]} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: d.answer === i }}
                accessibilityLabel={`${LETTERS[i]} е верният`}
                onPress={() => onChange({ ...d, answer: i })}
                hitSlop={4}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: d.answer === i ? colors.good : colors.lineStrong,
                  backgroundColor: d.answer === i ? `${colors.good}22` : 'transparent',
                }}
              >
                <T style={{ fontFamily: fonts.bold, color: d.answer === i ? colors.good : colors.fg3 }}>{LETTERS[i]}</T>
              </Pressable>
              <TextInput
                value={o}
                maxLength={SETS.option[1]}
                accessibilityLabel={`Отговор ${LETTERS[i]}`}
                onChangeText={(text) => onChange({ ...d, options: d.options.map((x, j) => (j === i ? text : x)) })}
                style={input(colors, d.answer === i)}
              />
            </View>
          ))}
          <T variant="caption" tone="fg3">
            Отбележи верния отговор. В мача отговорите се разбъркват.
          </T>
        </View>
      )}
      {d.kind === 'truefalse' && (
        <Choices
          label="Твърдението е"
          options={[
            { id: 'yes', label: 'Вярно е' },
            { id: 'no', label: 'Невярно е' },
          ]}
          value={d.answer ? 'yes' : 'no'}
          onChange={(v) => onChange({ ...d, answer: v === 'yes' })}
        />
      )}
      {d.kind === 'number' && (
        <View style={{ gap: 8 }}>
          <Field
            label="Верният отговор"
            value={d.answer}
            keyboardType="numbers-and-punctuation"
            onChangeText={(answer) => onChange({ ...d, answer, tolerance: d.tolerance || defaultTolerance(answer) })}
          />
          <Field
            label="Мерна единица"
            value={d.unit}
            maxLength={SETS.unit}
            placeholder="км, г., души…"
            onChangeText={(unit) => onChange({ ...d, unit })}
          />
          <Field
            label="Отклонение за 0 точки"
            value={d.tolerance}
            keyboardType="numbers-and-punctuation"
            onChangeText={(tolerance) => onChange({ ...d, tolerance })}
          />
          <T variant="caption" tone="fg3">
            Точно число носи най-много точки; колкото по-далеч, толкова по-малко, а отклонение от {d.tolerance || '…'} —
            нула.
          </T>
        </View>
      )}
      {d.kind === 'order' && (
        <View style={{ gap: 8 }}>
          <T variant="caption" tone="fg3">
            Напиши ги в правилния ред — в мача се разбъркват. Число към всяко (година, височина) е по желание: показва
            се с отговора.
          </T>
          {d.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed places, first to last
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T variant="bodyStrong" tone="fg3" style={{ width: 22, textAlign: 'right' }}>
                {i + 1}.
              </T>
              <TextInput
                value={item.text}
                maxLength={SETS.option[1]}
                accessibilityLabel={`Подреди — ${i + 1}.`}
                onChangeText={(text) =>
                  onChange({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, text } : x)) })
                }
                style={input(colors)}
              />
              <TextInput
                value={item.value}
                keyboardType="numbers-and-punctuation"
                placeholder="число"
                placeholderTextColor={colors.fg3}
                accessibilityLabel={`Число към ${i + 1}. (по желание)`}
                onChangeText={(value) =>
                  onChange({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, value } : x)) })
                }
                style={[input(colors), { flex: 0, width: 88 }]}
              />
            </View>
          ))}
          <Field
            label="Мерна единица на числата (по желание)"
            value={d.unit}
            maxLength={SETS.unit}
            placeholder="м, км², души…"
            onChangeText={(unit) => onChange({ ...d, unit })}
          />
        </View>
      )}
    </Card>
  );
}

const input = (colors: ReturnType<typeof useColors>, marked = false) => ({
  flex: 1,
  minHeight: 44,
  paddingHorizontal: 12,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: marked ? `${colors.good}88` : colors.lineStrong,
  backgroundColor: colors.ink2,
  color: colors.fg,
  fontFamily: fonts.regular,
  fontSize: 16,
});

/** A picture over the question, from the phone: made small, uploaded, kept with the set when it's saved. */
function PictureField({
  index,
  image,
  onChange,
}: {
  index: number;
  image?: SetImage;
  onChange: (image: SetImage | undefined) => void;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    setBusy(true);
    try {
      const small = await pickSetPicture();
      if (!small) return;
      const up = await api.uploadSetPicture(small);
      onChange({ id: up.id, w: up.w, h: up.h, alt: image?.alt ?? '', url: up.url });
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error && !('status' in err) ? err.message : errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  if (!image) return <Button title="🖼️ Снимка към въпроса" variant="ghost" loading={busy} onPress={() => void pick()} />;
  return (
    <View style={{ gap: 8 }}>
      <Image
        source={{ uri: setPictureUri(image) }}
        accessibilityLabel={`Снимката към въпрос ${index + 1}`}
        contentFit="cover"
        style={{
          height: 120,
          aspectRatio: image.w / image.h,
          maxWidth: '100%',
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      />
      <Field
        label="Какво има на снимката — за незрящите, без да издава отговора"
        value={image.alt}
        maxLength={SETS.imageAlt}
        placeholder="Напр. „Каменна крепост на хълм над река“"
        onChangeText={(alt) => onChange({ ...image, alt })}
      />
      <Button title="Махни снимката" variant="ghost" onPress={() => onChange(undefined)} />
    </View>
  );
}

function IconButton({
  label,
  icon,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.3 : 1,
        backgroundColor: pressed ? colors.lineStrong : 'transparent',
      })}
    >
      <T tone="fg2" style={{ fontFamily: fonts.bold }}>
        {icon}
      </T>
    </Pressable>
  );
}
