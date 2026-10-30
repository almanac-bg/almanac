import { api, errorMessage, setState as setStore, toast, useStore } from '@quiz/client';
import { AVATARS, EMOTES, FRAMES, type PendingChoice, TITLES, type UnlockRef } from '@quiz/shared';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from './Avatar';
import { Emoji } from './Emoji';
import { Button } from './ui';

/** An item's own name („Видра“), without its kind. */
export function itemName(u: UnlockRef): string {
  const list = { avatar: AVATARS, frame: FRAMES, title: TITLES, emote: EMOTES }[u.kind] as {
    id: string;
    name?: string;
  }[];
  return list.find((i) => i.id === u.id)?.name ?? '';
}

const KIND: Record<UnlockRef['kind'], string> = { avatar: 'аватар', frame: 'рамка', title: 'титла', emote: 'емоция' };

/**
 * A level milestone's reward to pick: its two side by side, and what was left at the milestones before it. Picked, it's
 * the player's at once (and `onPicked` says which); the other stays to pick at a later milestone.
 */
export function LevelChoice({
  choice,
  onPicked,
  className,
}: {
  choice: PendingChoice;
  onPicked?: (item: UnlockRef) => void;
  className?: string;
}) {
  const [selected, setSelected] = useState<UnlockRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<UnlockRef | null>(null);
  const same = (a: UnlockRef | null, b: UnlockRef) => !!a && a.kind === b.kind && a.id === b.id;

  async function take() {
    if (!selected) return;
    setBusy(true);
    try {
      const { user } = await api.chooseReward(choice.level, selected);
      setPicked(selected);
      setStore({ me: user });
      onPicked?.(selected);
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Наградата не се запази. Опитай пак.') });
    } finally {
      setBusy(false);
    }
  }

  if (picked) return <Picked item={picked} className={className} />;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3">
        {choice.options.map((o) => (
          <Option key={o.id} item={o} selected={same(selected, o)} onSelect={() => setSelected(o)} />
        ))}
      </div>
      {choice.earlier.length > 0 && (
        <>
          <p className="mt-4 text-sm text-fg-2">Или нещо, оставено на по-ранно ниво:</p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {choice.earlier.map((o) => (
              <Option
                key={`${o.kind}:${o.id}`}
                item={o}
                small
                selected={same(selected, o)}
                onSelect={() => setSelected(o)}
              />
            ))}
          </div>
        </>
      )}
      <p className="mt-4 text-xs text-fg-3">Каквото не вземеш сега, можеш да избереш на някое следващо ниво.</p>
      <Button className="mt-3 w-full" onClick={() => void take()} disabled={!selected} loading={busy}>
        {selected ? `Вземи „${itemName(selected)}“` : 'Избери едно'}
      </Button>
    </div>
  );
}

/** What was taken, on the player, with a button to wear it (an avatar, a frame or a title). */
function Picked({ item, className }: { item: UnlockRef; className?: string }) {
  const me = useStore((s) => s.me);
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const slot = item.kind === 'emote' ? null : item.kind;
  const worn = slot !== null && me[slot] === item.id;

  async function wear() {
    if (!slot) return;
    setSaving(true);
    try {
      const { user } = await api.loadout({ [slot]: item.id });
      setStore({ me: user });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Неуспешно запазване.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={clsx('flex flex-col items-center text-center', className)}>
      <Preview item={item} size={112} />
      <p role="status" className="mt-3 font-semibold text-balance text-emerald-300">
        <Check aria-hidden className="mr-1 inline size-4 align-[-2px]" />
        Взе „{itemName(item)}“ — вече е в „Колекция“
      </p>
      {slot &&
        (worn ? (
          <p className="mt-2 text-sm text-fg-2">Носиш го.</p>
        ) : (
          <Button className="mt-3" onClick={() => void wear()} loading={saving}>
            Сложи го
          </Button>
        ))}
    </div>
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
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={clsx(
        'focus-ring flex min-w-0 flex-col items-center rounded-2xl border text-center transition-colors',
        small ? 'gap-1 p-2' : 'gap-2 p-3 sm:p-4',
        selected ? 'border-violet-300 bg-violet-400/15' : 'border-line bg-tint/5 hover:bg-tint/10',
      )}
    >
      <Preview item={item} size={small ? 44 : 72} />
      <span className={clsx('max-w-full font-semibold text-balance', small ? 'text-xs' : 'text-sm')}>
        {itemName(item)}
      </span>
      {!small && <span className="text-xs text-fg-3">{KIND[item.kind]}</span>}
    </button>
  );
}

/** The item on the player as they are: a new avatar in their frame, a new frame around their avatar, a title as text. */
function Preview({ item, size }: { item: UnlockRef; size: number }) {
  const me = useStore((s) => s.me);
  if (!me) return null;
  if (item.kind === 'title')
    return (
      <span
        className="grid place-items-center rounded-full bg-amber-400/15 text-amber-300"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
        aria-hidden
      >
        <Emoji e="🏷️" />
      </span>
    );
  if (item.kind === 'emote') return <Emoji e={EMOTES.find((e) => e.id === item.id)?.emoji} size={size} />;
  return (
    <Avatar
      avatar={item.kind === 'avatar' ? item.id : me.avatar}
      frame={item.kind === 'frame' ? item.id : me.frame}
      size={size}
    />
  );
}
