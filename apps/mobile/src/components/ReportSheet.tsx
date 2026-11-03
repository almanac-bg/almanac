import { errorMessage } from '@almanac/client';
import { REPORT_REASONS, REPORT_REASONS_FOR, type ReportSubjectKind } from '@almanac/shared';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, gutter, radius, useColors } from '@/theme';
import { Button, T } from '@/ui';

const DETAILS_MAX = 500;

/** The reasons a report about a player, a group or a set can give. */
export const reasonsFor = (kind: ReportSubjectKind) =>
  REPORT_REASONS.filter((r) => REPORT_REASONS_FOR[kind].includes(r.id));

/**
 * A report (the web's report dialogs): what it's about (`context`), a reason, details if they help, and a `note` (that
 * it's anonymous). Sent, it says `thanks` and closes; if it couldn't be sent, it says why and stays open with what was
 * written. A player, a group, a set, a question: the same sheet with its own reasons.
 */
export function ReportSheet<R extends string>({
  open,
  onClose,
  title,
  reasons,
  context,
  placeholder = 'Подробности (по желание)',
  note,
  thanks = 'Модератор ще го прегледа, а ти ще научиш какво решихме.',
  send,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  reasons: readonly { id: R; label: string }[];
  context?: string;
  placeholder?: string;
  note?: string;
  thanks?: string;
  send: (reason: R, details: string) => Promise<unknown>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<R | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      await send(reason, details.trim());
      setReason(null);
      setDetails('');
      onClose();
      Alert.alert('Благодарим!', thanks);
    } catch (err) {
      Alert.alert('Докладът не се изпрати', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.ink }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + 24, gap: 12 }}
        >
          <T variant="h1" role="heading">
            {title}
          </T>
          {context ? (
            <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.glass }}>
              <T variant="small" tone="fg2">
                {context}
              </T>
            </View>
          ) : null}
          <View accessibilityRole="radiogroup" accessibilityLabel="Причина" style={{ gap: 8 }}>
            {reasons.map((r) => {
              const on = reason === r.id;
              return (
                <Pressable
                  key={r.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setReason(r.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 50,
                    paddingHorizontal: 14,
                    borderRadius: radius.lg,
                    borderCurve: 'continuous',
                    borderWidth: 1,
                    borderColor: on ? colors.bad : colors.line,
                    backgroundColor: on ? `${colors.bad}18` : colors.ink2,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: on ? colors.bad : colors.lineStrong,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.bad }} />}
                  </View>
                  <T style={{ flex: 1 }}>{r.label}</T>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={details}
            onChangeText={(text) => setDetails(text.slice(0, DETAILS_MAX))}
            accessibilityLabel={placeholder}
            placeholder={placeholder}
            placeholderTextColor={colors.fg3}
            multiline
            maxLength={DETAILS_MAX}
            style={{
              minHeight: 96,
              padding: 14,
              borderRadius: radius.md,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: colors.lineStrong,
              backgroundColor: colors.ink2,
              color: colors.fg,
              fontFamily: fonts.regular,
              fontSize: 16,
              textAlignVertical: 'top',
            }}
          />
          {note ? (
            <T variant="caption" tone="fg3">
              {note}
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Отказ" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button
              title="Изпрати доклад"
              variant="danger"
              disabled={!reason}
              loading={busy}
              onPress={() => void submit()}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
