import { actions } from '@almanac/client';
import { CATEGORIES, type CategoryChoice, SOLO_PACES, type SoloPace } from '@almanac/shared';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { radius, useColors } from '@/theme';
import { Button, T, useSheetPadding } from '@/ui';

/** Соло's choices: a category (or all of them mixed) and a pace, then the match. */
export function SoloSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const colors = useColors();
  const sheet = useSheetPadding();
  const [category, setCategory] = useState<CategoryChoice>('mixed');
  const [pace, setPace] = useState<SoloPace>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    const started = await actions.startSolo(category, pace);
    setBusy(false);
    if (started.ok) onClose();
    else setError(started.error);
  };
  const choices: { id: CategoryChoice; label: string }[] = [
    { id: 'mixed', label: '🎲 Смесени' },
    ...CATEGORIES.map((c) => ({ id: c.id as CategoryChoice, label: `${c.icon} ${c.name}` })),
  ];
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.ink }}>
        <ScrollView contentContainerStyle={{ ...sheet, gap: 16 }}>
          <T variant="h1" role="heading">
            Соло
          </T>
          <T variant="label" tone="fg3">
            Категория
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {choices.map((c) => (
              <Choice key={c.id} label={c.label} selected={category === c.id} onPress={() => setCategory(c.id)} />
            ))}
          </View>
          <T variant="label" tone="fg3">
            Темпо
          </T>
          {SOLO_PACES.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setPace(p.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: pace === p.id }}
              accessibilityLabel={`${p.label}: ${p.hint}`}
              style={{
                padding: 14,
                gap: 4,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: pace === p.id ? colors.violet : colors.line,
                backgroundColor: colors.ink2,
              }}
            >
              <T variant="bodyStrong">{p.label}</T>
              <T variant="small" tone="fg2">
                {p.hint}
              </T>
            </Pressable>
          ))}
          {error ? (
            <T variant="small" tone="bad" role="alert">
              {error}
            </T>
          ) : null}
          <Button title="Започни" size="lg" loading={busy} onPress={() => void start()} />
          <Button title="Отказ" variant="ghost" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={{
        minHeight: 44,
        paddingHorizontal: 14,
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? colors.violet : colors.line,
        backgroundColor: selected ? `${colors.violet}22` : colors.ink2,
      }}
    >
      <T variant="small" tone={selected ? 'fg' : 'fg2'}>
        {label}
      </T>
    </Pressable>
  );
}
