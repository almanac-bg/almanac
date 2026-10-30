import { MODERATION, MODERATION_BASES, type ModerationBasis } from '@quiz/shared';
import { Ban, Eye, EyeOff, PenLine } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, Segmented } from '../ui';

/**
 * The forms a moderator decides with. Each decision names its basis (a rule from the terms) and a reason in the
 * moderator's words: the player reads both, with where to appeal, and the log keeps them.
 */

const BAN_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1 ден' },
  { value: '7', label: '7 дни' },
  { value: '30', label: '30 дни' },
  { value: 'forever', label: 'Завинаги' },
];

export const basisLabel = (id: string | null) => MODERATION_BASES.find((b) => b.id === id)?.label ?? null;

export interface Grounds {
  basis: ModerationBasis | '';
  reason: string;
}

export const groundsReady = (g: Grounds) => !!g.basis && g.reason.trim().length >= MODERATION.reasonMin;

/** A basis from the list, and a reason the player will read. */
export function GroundsFields({
  grounds,
  onChange,
  reasonLabel = 'Причина — играчът ще я прочете',
  withBasis = true,
}: {
  grounds: Grounds;
  onChange: (g: Grounds) => void;
  reasonLabel?: string;
  withBasis?: boolean;
}) {
  const id = useId();
  const length = grounds.reason.trim().length;
  return (
    <div className="space-y-3">
      {withBasis && (
        <div>
          <label htmlFor={`${id}-basis`} className="mb-1.5 block text-xs font-semibold text-fg-2">
            Основание (от условията)
          </label>
          <select
            id={`${id}-basis`}
            value={grounds.basis}
            onChange={(e) => onChange({ ...grounds, basis: e.target.value as ModerationBasis | '' })}
            className="field h-10 w-full rounded-xl pr-10 pl-3 text-sm"
          >
            <option value="" className="bg-ink-2">
              Избери…
            </option>
            {MODERATION_BASES.map((b) => (
              <option key={b.id} value={b.id} className="bg-ink-2">
                {b.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-reason`} className="mb-1.5 block text-xs font-semibold text-fg-2">
          {reasonLabel}
        </label>
        <textarea
          id={`${id}-reason`}
          value={grounds.reason}
          onChange={(e) => onChange({ ...grounds, reason: e.target.value })}
          rows={2}
          maxLength={MODERATION.reasonMax}
          placeholder="Какво точно е нарушението, напр. „Името съдържа обида.“"
          className="field w-full resize-none rounded-xl px-3 py-2 text-sm"
        />
        <p className={length && length < MODERATION.reasonMin ? 'text-xs text-amber-300' : 'text-xs text-fg-3'}>
          {length < MODERATION.reasonMin ? `Поне ${MODERATION.reasonMin} знака.` : `${length}/${MODERATION.reasonMax}`}
        </p>
      </div>
    </div>
  );
}

/** How long, on what basis and why: stopping a profile (from a report, the play check or the player's card). */
export function BanForm({
  busy,
  onBan,
  onCancel,
  defaultBasis = '',
}: {
  busy: boolean;
  onBan: (
    ban: { days: number | null; basis: ModerationBasis; reason: string; annul: boolean },
    message: string,
  ) => void;
  onCancel: () => void;
  defaultBasis?: ModerationBasis | '';
}) {
  const [days, setDays] = useState('7');
  const [grounds, setGrounds] = useState<Grounds>({ basis: defaultBasis, reason: '' });
  const [annul, setAnnul] = useState(defaultBasis === 'cheating');
  return (
    <form
      className="mt-4 space-y-3 rounded-2xl border border-rose-400/25 bg-rose-500/[0.05] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!groundsReady(grounds)) return;
        onBan(
          {
            days: days === 'forever' ? null : Number(days),
            basis: grounds.basis as ModerationBasis,
            reason: grounds.reason.trim(),
            annul,
          },
          days === 'forever'
            ? 'Профилът е спрян завинаги'
            : `Профилът е спрян за ${BAN_OPTIONS.find((o) => o.value === days)!.label}`,
        );
      }}
    >
      <Segmented value={days} onChange={setDays} options={BAN_OPTIONS} />
      <GroundsFields
        grounds={grounds}
        onChange={(g) => {
          if (g.basis !== grounds.basis && g.basis === 'cheating') setAnnul(true);
          setGrounds(g);
        }}
      />
      <label className="flex items-start gap-2 text-sm text-fg-2">
        <input
          type="checkbox"
          checked={annul}
          onChange={(e) => setAnnul(e.target.checked)}
          className="mt-0.5 size-4 accent-rose-400"
        />
        <span>
          Анулирай резултатите от сезона: рейтинги, дневни и вечерни класирания
          <span className="block text-xs text-fg-3">При нечестна игра. Може да се отмени от „Дневник“.</span>
        </span>
      </label>
      <p className="text-xs text-fg-3">
        Играчът вижда основанието и причината при вход (и по имейл, ако има), с адреса за обжалване.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" type="submit" loading={busy} disabled={!groundsReady(grounds)}>
          <Ban className="size-4" /> Спри профила
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Отказ
        </Button>
      </div>
    </form>
  );
}

/** A new name, on what basis and why. */
export function RenameForm({
  busy,
  onRename,
  onCancel,
}: {
  busy: boolean;
  onRename: (rename: { username: string; basis: ModerationBasis; reason: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [grounds, setGrounds] = useState<Grounds>({ basis: 'name', reason: '' });
  const ready = name.trim().length >= 3 && groundsReady(grounds);
  return (
    <form
      noValidate
      className="mt-4 space-y-3 rounded-2xl border border-line bg-sunk/20 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready)
          onRename({ username: name.trim(), basis: grounds.basis as ModerationBasis, reason: grounds.reason.trim() });
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ново име"
        aria-label="Ново име"
        // biome-ignore lint/a11y/noAutofocus: it appears on clicking "Смени името", so focus moves to it
        autoFocus
        className="field h-10 w-full rounded-xl px-3 text-sm"
      />
      <GroundsFields grounds={grounds} onChange={setGrounds} />
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy} disabled={!ready}>
          <PenLine className="size-4" /> Смени името
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Отказ
        </Button>
      </div>
    </form>
  );
}

/**
 * Hiding a shared set (a basis and a reason its owner reads) or showing it again (why): from a case, the player's card
 * or the set's page.
 */
export function SetVisibilityForm({
  hidden,
  busy,
  onSubmit,
  onCancel,
}: {
  /** Whether it's hidden now: the form does the opposite. */
  hidden: boolean;
  busy: boolean;
  onSubmit: (grounds: { basis?: ModerationBasis; reason: string; copies?: boolean }) => void;
  onCancel: () => void;
}) {
  const [grounds, setGrounds] = useState<Grounds>({ basis: hidden ? 'other' : 'content', reason: '' });
  const [copies, setCopies] = useState(true);
  const ready = hidden ? grounds.reason.trim().length >= MODERATION.reasonMin : groundsReady(grounds);
  return (
    <form
      className="mt-4 space-y-3 rounded-2xl border border-line bg-sunk/20 p-4 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready)
          onSubmit(
            hidden
              ? { reason: grounds.reason.trim() }
              : { basis: grounds.basis as ModerationBasis, reason: grounds.reason.trim(), copies },
          );
      }}
    >
      <p className="text-xs text-fg-3">
        {hidden
          ? 'Наборът отново ще може да се играе и копира; собственикът научава защо.'
          : 'Наборът вече няма да може да се играе в стаи, нито да се копира, а снимките му спират да се показват. Собственикът научава основанието и причината, с адреса за обжалване.'}
      </p>
      <GroundsFields
        grounds={grounds}
        onChange={setGrounds}
        withBasis={!hidden}
        reasonLabel={hidden ? 'Защо го показваш отново — собственикът ще го прочете' : undefined}
      />
      {!hidden && (
        <label className="flex items-start gap-2 text-sm text-fg-2">
          <input
            type="checkbox"
            checked={copies}
            onChange={(e) => setCopies(e.target.checked)}
            className="mt-0.5 size-4 accent-rose-400"
          />
          <span>
            Скрий и копията, които други домакини са взели от него
            <span className="block text-xs text-fg-3">Всеки собственик на копие научава защо.</span>
          </span>
        </label>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant={hidden ? 'primary' : 'danger'} type="submit" loading={busy} disabled={!ready}>
          {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} {hidden ? 'Покажи' : 'Скрий набора'}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Отказ
        </Button>
      </div>
    </form>
  );
}
