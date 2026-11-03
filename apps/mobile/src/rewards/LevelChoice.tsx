import { api, errorMessage, ITEM_KIND, itemName, setState, toast, useStore } from '@almanac/client';
import { EMOTES, type PendingChoice, type UnlockRef } from '@almanac/shared';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Avatar, Button, T } from '@/ui';

const same = (a: UnlockRef | null, b: UnlockRef) => !!a && a.kind === b.kind && a.id === b.id;

/**
 * A level milestone's reward to pick (the web's LevelChoice): its two side by side, and what was left at the milestones
 * before it. Picked, it's the player's at once (and `onPicked` says which); the other stays for a later milestone.
 */
export function LevelChoice({ choice, onPicked }: { choice: PendingChoice; onPicked?: (item: UnlockRef) => void }) {
  const [selected, setSelected] = useState<UnlockRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<UnlockRef | null>(null);
  const take = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const { user } = await api.chooseReward(choice.level, selected);
      setPicked(selected);
      setState({ me: user });
      onPicked?.(selected);
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Наградата не се запази. Опитай пак.') });
    } finally {
      setBusy(false);
    }
  };
  if (picked) return <Picked item={picked} />;
  return (
    <View style={{ gap: 12, alignSelf: 'stretch' }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Награда" style={{ flexDirection: 'row', gap: 10 }}>
        {choice.options.map((o) => (
          <Option key={`${o.kind}:${o.id}`} item={o} selected={same(selected, o)} onSelect={() => setSelected(o)} />
        ))}
      </View>
      {choice.earlier.length > 0 && (
        <>
          <T variant="small" tone="fg2">
            Или нещо, оставено на по-ранно ниво:
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {choice.earlier.map((o) => (
              <Option
                key={`${o.kind}:${o.id}`}
                item={o}
                small
                selected={same(selected, o)}
                onSelect={() => setSelected(o)}
              />
            ))}
          </View>
        </>
      )}
      <T variant="caption" tone="fg3">
        Каквото не вземеш сега, можеш да избереш на някое следващо ниво.
      </T>
      <Button
        title={selected ? `Вземи „${itemName(selected)}“` : 'Избери едно'}
        disabled={!selected}
        loading={busy}
        onPress={() => void take()}
      />
    </View>
  );
}

/** What was taken, on the player, with a button to wear it (an avatar, a frame or a title). */
function Picked({ item }: { item: UnlockRef }) {
  const me = useStore((s) => s.me);
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const slot = item.kind === 'emote' ? null : item.kind;
  const worn = slot !== null && me[slot] === item.id;
  const wear = async () => {
    if (!slot) return;
    setSaving(true);
    try {
      const { user } = await api.loadout({ [slot]: item.id });
      setState({ me: user });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Неуспешно запазване.') });
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Preview item={item} size={112} />
      <T tone="good" align="center" style={{ fontFamily: fonts.semibold }} accessibilityLiveRegion="polite">
        ✓ Взе „{itemName(item)}“ — вече е в „Колекция“
      </T>
      {slot &&
        (worn ? (
          <T variant="small" tone="fg2">
            Носиш {slot === 'avatar' ? 'го' : 'я'}.
          </T>
        ) : (
          <Button title={`Сложи ${slot === 'avatar' ? 'го' : 'я'}`} loading={saving} onPress={() => void wear()} />
        ))}
    </View>
  );
}

function Option({
  item,
  selected,
  small = false,
  onSelect,
}: {
  item: UnlockRef;
  selected: boolean;
  small?: boolean;
  onSelect: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${itemName(item)}, ${ITEM_KIND[item.kind]}`}
      onPress={onSelect}
      style={{
        flex: small ? undefined : 1,
        minWidth: small ? 76 : undefined,
        alignItems: 'center',
        gap: small ? 4 : 8,
        padding: small ? 8 : 12,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.violet : colors.line,
        backgroundColor: selected ? `${colors.violet}26` : colors.glass,
      }}
    >
      <Preview item={item} size={small ? 44 : 72} />
      <T variant={small ? 'caption' : 'small'} align="center" style={{ fontFamily: fonts.semibold }}>
        {itemName(item)}
      </T>
      {!small && (
        <T variant="caption" tone="fg3">
          {ITEM_KIND[item.kind]}
        </T>
      )}
    </Pressable>
  );
}

/** The item on the player as they are: a new avatar in their frame, a new frame around their avatar, a title as a tag. */
export function Preview({ item, size }: { item: UnlockRef; size: number }) {
  const colors = useColors();
  const me = useStore((s) => s.me);
  if (!me) return null;
  if (item.kind === 'title' || item.kind === 'emote')
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${colors.gold}26`,
        }}
      >
        <T style={{ fontSize: size * 0.45, lineHeight: size * 0.6 }}>
          {item.kind === 'title' ? '🏷️' : (EMOTES.find((e) => e.id === item.id)?.emoji ?? '🙂')}
        </T>
      </View>
    );
  return (
    <Avatar
      avatar={item.kind === 'avatar' ? item.id : me.avatar}
      frame={item.kind === 'frame' ? item.id : me.frame}
      size={size}
    />
  );
}
