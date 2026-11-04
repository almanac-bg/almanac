import {
  api,
  cleanDraft,
  type DraftErrors,
  emptyQuestionDraft,
  errorMessage,
  hasErrors,
  pendingLimit,
  plural,
  SUBMISSION_LABELS,
  timeAgo,
  toast,
  toQuestionDraft,
  useStore,
  validateDraft,
} from '@almanac/client';
import { categoryById, levelFromXp, type QuestionDraft, SUBMISSION_RULES, type Submission } from '@almanac/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, View } from 'react-native';
import { useLoad } from '@/lib/load';
import { DraftFields } from '@/submit/DraftFields';
import { fonts, radius, useColors } from '@/theme';
import { Button, Card, LoadError, Progress, Screen, T, useSheetPadding } from '@/ui';

/**
 * Предложи въпрос (the web's SubmitPage): a question for the game, checked by a moderator and, approved, played with
 * its author's name — and the questions already sent, with how they're doing. From level SUBMISSION_RULES.minLevel,
 * for an account.
 */
export default function Submit() {
  const me = useStore((s) => s.me);
  const [sent, setSent] = useState(0);
  if (!me) return null;
  const level = levelFromXp(me.xp);
  const unlocked = level >= SUBMISSION_RULES.minLevel;
  return (
    <Screen>
      <T tone="fg2">
        Измисли въпрос за играта. Модератор го преглежда и ако бъде одобрен, влиза в мачовете с твоето име — плюс{' '}
        <T tone="link" style={{ fontFamily: fonts.bold }}>
          {SUBMISSION_RULES.approvedXp} XP
        </T>{' '}
        и прогрес към постиженията „Първо перо“ и „Златно перо“.
      </T>
      {me.isGuest ? (
        <Card>
          <T variant="small" tone="fg2">
            Въпросите влизат в играта с името на автора — запази профила си с име и парола, за да предлагаш.
          </T>
          <Button title="Запази профила" variant="secondary" onPress={() => router.push('/settings')} />
        </Card>
      ) : unlocked ? (
        <>
          <SubmitForm onSent={() => setSent((n) => n + 1)} />
          <MySubmissions refresh={sent} />
        </>
      ) : (
        <Card style={{ alignItems: 'center', gap: 10 }}>
          <T style={{ fontSize: 36, lineHeight: 44 }}>🔒</T>
          <T variant="title" align="center">
            Отключва се на ниво {SUBMISSION_RULES.minLevel}
          </T>
          <T tone="fg2" align="center">
            Изиграй още няколко мача — нужни са ти още {plural(SUBMISSION_RULES.minLevel - level, 'ниво', 'нива')}, за
            да предлагаш въпроси.
          </T>
          <Progress
            value={level / SUBMISSION_RULES.minLevel}
            label="До предлагането на въпроси"
            valueText={`Ниво ${level} от ${SUBMISSION_RULES.minLevel}`}
            style={{ alignSelf: 'stretch' }}
          />
        </Card>
      )}
    </Screen>
  );
}

function SubmitForm({ onSent }: { onSent: () => void }) {
  const [draft, setDraft] = useState<QuestionDraft>(emptyQuestionDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const submit = async () => {
    if (hasErrors(errors)) return setShowErrors(true);
    setBusy(true);
    try {
      await api.submitQuestion(cleanDraft(draft));
      toast({ kind: 'success', title: 'Благодарим! Въпросът чака одобрение.', icon: '✍️' });
      setDraft(emptyQuestionDraft());
      setShowErrors(false);
      onSent();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Неуспешно изпращане.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 16 }}>
      <DraftFields draft={draft} onChange={setDraft} errors={showErrors ? errors : {}} />
      <T variant="caption" tone="fg3">
        Съвет: един безспорно верен отговор и три правдоподобни грешни, от един вид (все градове, все години). Без
        въпроси, чийто отговор се променя с времето, и без думи във въпроса, които издават отговора.
      </T>
      <Button title="Изпрати за одобрение" size="lg" loading={busy} onPress={() => void submit()} />
    </Card>
  );
}

function MySubmissions({ refresh }: { refresh: number }) {
  const colors = useColors();
  const { data, error, reload, set } = useLoad(() => api.mySubmissions(), refresh);
  const [editing, setEditing] = useState<Submission | null>(null);
  const items = data?.submissions ?? null;
  const approved = items?.filter((s) => s.status === 'approved').length ?? 0;
  const pending = items?.filter((s) => s.status === 'pending').length ?? 0;
  const limit = items ? pendingLimit(items) : 0;
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <T variant="h2" role="heading">
          Моите предложения
        </T>
        {items && items.length > 0 && (
          <T variant="small" tone={pending >= limit ? 'gold' : 'fg3'}>
            {plural(approved, 'одобрен', 'одобрени')} · чакат {pending} от {limit}
          </T>
        )}
      </View>
      {items && pending >= limit && (
        <T variant="small" tone="fg2">
          {limit === 1
            ? 'Един въпрос чака преглед. След него можеш да изпратиш следващия.'
            : `Стигна до ${limit} чакащи въпроса. Когато модератор ги прегледа, можеш да изпратиш още.`}
          {limit === SUBMISSION_RULES.maxPendingNew ? ' След първия одобрен може да чакат повече наведнъж.' : ''}
        </T>
      )}
      {error && !items ? (
        <LoadError title="Предложенията ти не се заредиха" error={error} onRetry={reload} />
      ) : !items ? (
        <ActivityIndicator />
      ) : items.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <T style={{ fontSize: 32, lineHeight: 40 }}>✍️</T>
          <T variant="title" align="center">
            Още нямаш предложения
          </T>
          <T tone="fg2" align="center">
            Първият ти одобрен въпрос отключва постижението „Първо перо“.
          </T>
        </Card>
      ) : (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {items.map((s, i) => {
            const cat = categoryById(s.category);
            const tone = s.status === 'approved' ? 'good' : s.status === 'rejected' ? 'bad' : 'gold';
            return (
              <View
                key={s.id}
                style={{ gap: 6, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}
              >
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <T style={{ fontSize: 22, lineHeight: 28 }}>{cat?.icon}</T>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong">{s.q}</T>
                    <T variant="caption" tone="fg3">
                      Верен:{' '}
                      <T variant="caption" tone="good">
                        {s.options[s.answer]}
                      </T>{' '}
                      · {timeAgo(s.createdAt)}
                    </T>
                    {s.status === 'rejected' && s.reason && (
                      <T variant="caption" tone="bad">
                        Причина: {s.reason}
                      </T>
                    )}
                    {s.played && (
                      <T variant="caption" tone="fg3">
                        {s.played.answered
                          ? `Изигран ${plural(s.played.answered, 'път', 'пъти')} · ${Math.round((100 * s.played.correct) / s.played.answered)}% верни`
                          : 'Още не е попаднал в мач'}
                      </T>
                    )}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 2,
                      borderRadius: 999,
                      backgroundColor: `${colors[tone]}22`,
                    }}
                  >
                    <T variant="caption" tone={tone} style={{ fontFamily: fonts.bold }}>
                      {SUBMISSION_LABELS[s.status]}
                    </T>
                  </View>
                  {s.status === 'pending' && (
                    <Button
                      title="✎ Промени"
                      label={`Промени „${s.q}“`}
                      variant="ghost"
                      onPress={() => setEditing(s)}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </Card>
      )}
      <EditSheet
        submission={editing}
        onClose={() => setEditing(null)}
        onSaved={(changed) =>
          data && set({ submissions: data.submissions.map((s) => (s.id === changed.id ? changed : s)) })
        }
        onWithdrawn={(id) => data && set({ submissions: data.submissions.filter((s) => s.id !== id) })}
      />
    </>
  );
}

/** A question still waiting, changed or taken back by its author. */
function EditSheet({
  submission,
  onClose,
  onSaved,
  onWithdrawn,
}: {
  submission: Submission | null;
  onClose: () => void;
  onSaved: (s: Submission) => void;
  onWithdrawn: (id: number) => void;
}) {
  const colors = useColors();
  const sheet = useSheetPadding();
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const current = draft ?? (submission ? toQuestionDraft(submission) : null);
  const close = () => {
    setDraft(null);
    setErrors({});
    onClose();
  };
  const save = async () => {
    if (!submission || !current) return;
    const found = validateDraft(current);
    setErrors(found);
    if (hasErrors(found)) return;
    setBusy(true);
    try {
      const { submission: saved } = await api.editSubmission(submission.id, cleanDraft(current));
      onSaved(saved);
      toast({ kind: 'success', title: 'Промените са запазени.' });
      close();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Промените не се запазиха.') });
    } finally {
      setBusy(false);
    }
  };
  const withdraw = () => {
    if (!submission) return;
    Alert.alert('Да оттеглиш ли въпроса?', 'Модераторът няма да го види.', [
      { text: 'Не', style: 'cancel' },
      {
        text: 'Да, оттегли го',
        style: 'destructive',
        onPress: () =>
          void api.withdrawSubmission(submission.id).then(
            () => {
              onWithdrawn(submission.id);
              toast({ kind: 'info', title: 'Въпросът е оттеглен.' });
              close();
            },
            (err: unknown) => toast({ kind: 'error', title: errorMessage(err, 'Въпросът не се оттегли.') }),
          ),
      },
    ]);
  };
  return (
    <Modal visible={!!submission} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: colors.ink }}
        contentContainerStyle={{ ...sheet, gap: 14 }}
      >
        <T variant="h1" role="heading">
          Промени предложението
        </T>
        {current && <DraftFields draft={current} onChange={setDraft} errors={errors} />}
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            paddingTop: 6,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            borderRadius: radius.sm,
          }}
        >
          <Button title="Оттегли въпроса" variant="ghost" onPress={withdraw} />
          <View style={{ flex: 1 }} />
          <Button title="Отказ" variant="ghost" onPress={close} />
          <Button title="Запази" loading={busy} onPress={() => void save()} />
        </View>
      </ScrollView>
    </Modal>
  );
}
