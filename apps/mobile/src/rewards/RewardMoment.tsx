import { type RewardStep, unlockPreview, useStore } from '@almanac/client';
import { LEVEL_CHOICES, type UnlockRef } from '@almanac/shared';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useWear } from '@/results/Cards';
import { fonts, gutter, radius, useColors } from '@/theme';
import { Button, T } from '@/ui';
import { LevelChoice, Preview } from './LevelChoice';

/**
 * The rewards of a match, one beat at a time before its results (the web's RewardMoment): the new level, a milestone's
 * reward to pick (one of two), then each new avatar or frame, large, with „Сложи го“. „Нататък“ goes on; Android's back
 * (or „Към резултата“) skips the rest. An ordinary match has none and goes straight to its results.
 */
export function RewardMoment({ steps, open, onDone }: { steps: RewardStep[]; open: boolean; onDone: () => void }) {
  const colors = useColors();
  const [at, setAt] = useState(0);
  const step = steps[at];
  // A beat felt as it comes: the new level the most.
  useEffect(() => {
    if (!open || !step) return;
    void (
      step.kind === 'level'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    ).catch(() => {});
  }, [open, step]);
  if (!step) return null;
  const last = at + 1 >= steps.length;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'center', padding: gutter, backgroundColor: '#000000b3' }}>
        <View
          accessibilityViewIsModal
          accessibilityLabel="Ново от този мач"
          style={{
            maxHeight: '90%',
            width: '100%',
            maxWidth: 420,
            alignSelf: 'center',
            borderRadius: radius.xl,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: colors.lineStrong,
            backgroundColor: colors.ink2,
          }}
        >
          <ScrollView contentContainerStyle={{ padding: 22, alignItems: 'center', gap: 16 }}>
            <Beat key={at} step={step} last={last} onNext={() => (last ? onDone() : setAt(at + 1))} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Beat({ step, last, onNext }: { step: RewardStep; last: boolean; onNext: () => void }) {
  // A milestone's reward: until it's picked, going on leaves it for later („Колекция“ keeps it waiting).
  const [chose, setChose] = useState(false);
  const deferring = step.kind === 'choice' && !chose;
  return (
    <>
      {step.kind === 'level' ? (
        <>
          <T variant="label" tone="gold">
            Ново ниво
          </T>
          <T
            accessibilityLabel={`Ниво ${step.level}`}
            style={{ fontFamily: fonts.displayHeavy, fontSize: 88, lineHeight: 100 }}
          >
            {step.level}
          </T>
        </>
      ) : step.kind === 'choice' ? (
        <ChoiceStep level={step.level} onPicked={() => setChose(true)} />
      ) : (
        <Unlocked unlock={step.unlock} more={step.more} />
      )}
      <Button
        title={deferring ? 'Избери по-късно' : last ? 'Към резултата' : 'Нататък'}
        size="lg"
        variant={step.kind === 'unlock' || deferring ? 'ghost' : 'primary'}
        onPress={onNext}
        style={{ alignSelf: 'stretch' }}
      />
    </>
  );
}

/**
 * Every fifth level: a reward to pick, one of two. What it offers comes with the player's profile; until that's back
 * from the match, the milestone's own two.
 */
function ChoiceStep({ level, onPicked }: { level: number; onPicked: () => void }) {
  const pending = useStore((s) => s.me?.choices.find((c) => c.level === level));
  const choice = pending ?? {
    level,
    options: LEVEL_CHOICES.find((c) => c.level === level)?.options ?? [],
    earlier: [],
  };
  return (
    <>
      <T variant="label" tone="gold" align="center">
        Ниво {level}: избери награда
      </T>
      <LevelChoice choice={choice} onPicked={onPicked} />
    </>
  );
}

/** A new avatar or frame on the player as they are, and a button to wear it. */
function Unlocked({ unlock, more }: { unlock: UnlockRef; more: number }) {
  const { name } = unlockPreview(unlock);
  const wearable = unlock.kind === 'avatar' || unlock.kind === 'frame' ? { kind: unlock.kind, id: unlock.id } : null;
  const { worn, saving, wear } = useWear(wearable);
  // „го“ for an avatar, „я“ for a frame (рамка).
  const it = unlock.kind === 'avatar' ? 'го' : 'я';
  return (
    <>
      <T variant="label" tone="gold">
        Ново за теб
      </T>
      <Preview item={unlock} size={144} />
      <T variant="h2" align="center">
        {name}
      </T>
      {more > 0 && (
        <T variant="small" tone="fg2">
          и още {more} — в „Колекция“
        </T>
      )}
      {wearable &&
        (worn ? (
          <T variant="small" tone="good" style={{ fontFamily: fonts.semibold }}>
            ✓ Носиш {it}
          </T>
        ) : (
          <Button title={`Сложи ${it}`} loading={saving} onPress={() => void wear()} />
        ))}
    </>
  );
}
