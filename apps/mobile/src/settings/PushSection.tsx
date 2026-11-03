import { api, errorMessage, setState, toast, useStore } from '@almanac/client';
import { PUSH, PUSH_KINDS, type PushKind, type PushPrefs } from '@almanac/shared';
import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { disablePush, enablePush, pushBlocked, pushOnHere } from '@/lib/push';
import { fonts } from '@/theme';
import { Button, T } from '@/ui';
import { Choices, Section, Toggle } from '@/ui/controls';

const clock = (minute: number) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
const DAILY_TIMES = Array.from(
  { length: (PUSH.dailyTo - PUSH.dailyFrom) / PUSH.dailyStep + 1 },
  (_, i) => PUSH.dailyFrom + i * PUSH.dailyStep,
);

/**
 * Settings → notifications on this phone (the web's PushSettings): on or off here (each phone asks its own
 * permission), and what to send (the player's choice, for all their devices). Push rests on consent — under 14, a
 * parent's: asked first, as the optional mails ask.
 */
export function PushSection() {
  const prefs = useStore((s) => s.me?.push ?? null);
  const [here, setHere] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushOnHere().then(setHere, () => setHere(false));
    void pushBlocked().then(setBlocked, () => {});
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const on = await enablePush();
      setHere(on);
      if (!on) setBlocked(await pushBlocked());
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Известията не се включиха на този телефон.') });
    } finally {
      setBusy(false);
    }
  };
  const confirm = () =>
    Alert.alert(
      'Известия на телефона',
      `Ще идват кратки известия на този телефон — най-много ${PUSH.perDay} на ден. Спираш ги по всяко време оттук.\n\nПотвърждаваш, че имаш навършени 14 години или имаш съгласие на родител или настойник.`,
      [
        { text: 'Отказ', style: 'cancel' },
        { text: 'Потвърждавам, включи', onPress: () => void enable() },
      ],
    );
  const disable = async () => {
    setBusy(true);
    try {
      await disablePush();
      setHere(false);
      toast({ kind: 'info', title: 'Известията са изключени на този телефон' });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const save = async (next: PushPrefs) => {
    try {
      const { user } = await api.setPushPrefs(next);
      setState({ me: user });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  };
  const toggle = (kind: PushKind) =>
    prefs && void save({ ...prefs, kinds: { ...prefs.kinds, [kind]: !prefs.kinds[kind] } });

  return (
    <Section title="Известия на телефона">
      <T variant="small" tone="fg2">
        Кратко известие, когато е важно: напомняне за въпросите на деня, серията в опасност, твой ред в дуел. Най-много{' '}
        {PUSH.perDay} на ден и нищо между {PUSH.quietFrom}:00 и {PUSH.quietUntil}:00.
      </T>
      {here === null ? null : blocked && !here ? (
        <View style={{ gap: 8 }}>
          <T variant="small" tone="gold">
            Известията за АЛМАНАХ са спрени в настройките на телефона. Разреши ги там и се върни тук.
          </T>
          <Button title="Към настройките на телефона" variant="secondary" onPress={() => void Linking.openSettings()} />
        </View>
      ) : here ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <T variant="small" tone="good" style={{ fontFamily: fonts.semibold }}>
            ✓ Включени на този телефон
          </T>
          <Button title="Изключи тук" variant="ghost" loading={busy} onPress={() => void disable()} />
        </View>
      ) : (
        <Button title="Включи на този телефон" loading={busy} onPress={confirm} />
      )}
      {prefs && (
        <View style={{ gap: 12, paddingTop: 6 }}>
          <T variant="caption" tone="fg3">
            Какво да идва — за всичките ти устройства с включени известия:
          </T>
          <T variant="bodyStrong">Напомняне за въпросите на деня</T>
          <T variant="small" tone="fg2">
            Само ако дотогава въпросите още те чакат
          </T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Choices
              label="Напомняне за въпросите на деня"
              options={[{ id: 'none', label: 'Без' }, ...DAILY_TIMES.map((m) => ({ id: String(m), label: clock(m) }))]}
              value={prefs.daily === null ? 'none' : String(prefs.daily)}
              onChange={(v) => void save({ ...prefs, daily: v === 'none' ? null : Number(v) })}
            />
          </ScrollView>
          {PUSH_KINDS.map((k) => (
            <Toggle key={k.id} label={k.label} hint={k.hint} value={prefs.kinds[k.id]} onChange={() => toggle(k.id)} />
          ))}
        </View>
      )}
    </Section>
  );
}
