import { actions, dropInvite, toast, useNow, useStore } from '@almanac/client';
import { avatarEmoji, type Invite } from '@almanac/shared';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Button, T } from '@/ui';

/**
 * A friend's invitation to play Отбори together, as it comes (the web's Invites): who, and a minute to say yes. Yes,
 * the two of you wait in the queue as a pair (its screen opens by itself). Not over a match. An invitation into a room
 * comes with the app's room screen.
 */
export function Invites() {
  const invites = useStore((s) => s.invites);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  if (inGame) return null;
  return (
    <>
      {invites
        .filter((i) => i.kind === 'duo')
        .map((i) => (
          <InviteCard key={i.id} invite={i} />
        ))}
    </>
  );
}

function InviteCard({ invite }: { invite: Invite }) {
  const colors = useColors();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const left = Math.max(0, Math.ceil((invite.expiresAt - now) / 1000));
  const line = `${invite.from.username} те кани за Отбори — двамата срещу двама.`;
  // A screen reader hears it as it arrives (the countdown isn't read out every second).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it comes
  useEffect(() => AccessibilityInfo.announceForAccessibility(`Покана: ${line}`), []);

  const accept = async () => {
    setBusy(true);
    const res = await actions.acceptDuo(invite.id);
    setBusy(false);
    dropInvite(invite.id);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  };

  return (
    <View
      style={{
        width: '100%',
        maxWidth: 480,
        gap: 12,
        padding: 14,
        borderRadius: radius.xl,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: '#e879f966',
        backgroundColor: colors.ink2,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
        overflow: 'hidden',
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: 3,
          width: `${Math.round((left / 60) * 100)}%`,
          backgroundColor: '#e879f9',
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <T style={{ fontSize: 34, lineHeight: 42 }}>{avatarEmoji(invite.from.avatar)}</T>
        <View style={{ flex: 1 }}>
          <T variant="label" style={{ color: colors.link }}>
            Покана
          </T>
          <T variant="small">
            <T variant="small" style={{ fontFamily: fonts.bold }}>
              {invite.from.username}
            </T>{' '}
            те кани за Отбори — двамата срещу двама.
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Откажи" variant="ghost" onPress={() => actions.declineInvite(invite)} style={{ flex: 1 }} />
        <Button
          title={`Играй · ${left} с`}
          label={`Играй Отбори с ${invite.from.username}`}
          loading={busy}
          onPress={() => void accept()}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}
