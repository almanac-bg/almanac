import { api, errorMessage, recordLine } from '@almanac/client';
import type { ProfileStats } from '@almanac/shared';
import { useState } from 'react';
import { AccessibilityInfo, Alert, View } from 'react-native';
import { DuelButton } from '@/components/DuelButton';
import { ReportSheet, reasonsFor } from '@/components/ReportSheet';
import { fonts, useColors } from '@/theme';
import { Button, T } from '@/ui';

const BLOCK_LINE =
  'Профилът изчезва от приятелите ти (ако е там), никой от двама ви не праща покани на другия и не влиза в стаята му, а класираните мачове не ви събират — нито със запис на мач на другия. Можеш да го отблокираш по всяко време от Настройки. Ако има нарушение, докладвай го — блокирането не стига до модераторите.';

/**
 * What you can do about another player: be friends (add, accept, a Дуел once you are), report them, block them.
 * Friends need a saved account; reporting and blocking anyone may (the stores ask it of every player).
 */
export function PlayerActions({
  profile,
  guest,
  onChange,
}: {
  profile: ProfileStats;
  guest: boolean;
  onChange: (p: ProfileStats) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const { user, blocked } = profile;

  /**
   * A change, then the profile as it is now (the friendship, the block). `done` is said in a dialog; `said`, only to a
   * screen reader (a block shows itself: the button turns to „Отблокирай“).
   */
  const run = async (fn: () => Promise<unknown>, done?: { alert?: string; said?: string }) => {
    setBusy(true);
    try {
      await fn();
      onChange(await api.profile(user.username));
      if (done?.alert) Alert.alert(done.alert);
      if (done?.said) AccessibilityInfo.announceForAccessibility(done.said);
    } catch (err) {
      Alert.alert('Не стана', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const block = () =>
    Alert.alert(`Да блокирам ли ${user.username}?`, BLOCK_LINE, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Блокирай',
        style: 'destructive',
        onPress: () => void run(() => api.block(user.id), { said: `${user.username} е блокиран профил` }),
      },
    ]);

  return (
    <View style={{ gap: 10 }}>
      {!guest && !blocked && <Friendship profile={profile} busy={busy} run={run} />}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title="🚩 Докладвай"
          variant="ghost"
          hint="Докладва играча на модераторите"
          onPress={() => setReporting(true)}
          style={{ flex: 1 }}
        />
        {blocked ? (
          <Button
            title="Отблокирай"
            variant="ghost"
            loading={busy}
            onPress={() => void run(() => api.unblock(user.id), { said: 'Профилът е отблокиран' })}
            style={{ flex: 1 }}
          />
        ) : (
          <Button title="🚫 Блокирай" variant="ghost" disabled={busy} onPress={block} style={{ flex: 1 }} />
        )}
      </View>
      <ReportSheet
        open={reporting}
        onClose={() => setReporting(false)}
        reasons={reasonsFor('player')}
        note="Докладите са анонимни за докладвания играч."
        title={`Докладвай ${user.username}`}
        send={(reason, details) => api.report(user.username, reason, details)}
      />
    </View>
  );
}

/** Add, accept, or (friends already) a Дуел and how your duels have gone. */
function Friendship({
  profile,
  busy,
  run,
}: {
  profile: ProfileStats;
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: { alert?: string }) => Promise<void>;
}) {
  const colors = useColors();
  const { user, friendship, duels } = profile;
  if (friendship === 'friends')
    return (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 }}>
          <T variant="small" tone="good" style={{ fontFamily: fonts.semibold }}>
            ✓ Приятели
          </T>
          {duels && (
            <T variant="small" tone="fg2">
              Дуели:{' '}
              <T variant="small" style={{ fontFamily: fonts.bold, color: colors.fg }}>
                {recordLine(duels)}
              </T>
            </T>
          )}
        </View>
        <DuelButton friendId={user.id} />
      </View>
    );
  if (friendship === 'outgoing') return <Button title="Поканата е изпратена" variant="secondary" disabled />;
  if (friendship === 'incoming')
    return (
      <Button
        title="Приеми поканата"
        loading={busy}
        onPress={() => void run(() => api.acceptFriend(user.id), { alert: 'Вече сте приятели!' })}
      />
    );
  return (
    <Button
      title="Добави приятел"
      loading={busy}
      onPress={() => void run(() => api.addFriend(user.username), { alert: 'Поканата е изпратена' })}
    />
  );
}
