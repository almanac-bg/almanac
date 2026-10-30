import { REPORT_REASONS, REPORT_REASONS_FOR, type ReportReason, type ReportSubjectKind } from '@quiz/shared';
import clsx from 'clsx';

/** The reasons a report about this kind of thing (a player, a group, a set) can give: pick one. */
export function ReportReasons({
  kind,
  value,
  onChange,
}: {
  kind: ReportSubjectKind;
  value: ReportReason | null;
  onChange: (reason: ReportReason) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Причина</legend>
      {REPORT_REASONS.filter((r) => REPORT_REASONS_FOR[kind].includes(r.id)).map((r) => (
        <label
          key={r.id}
          className={clsx(
            'flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors',
            value === r.id ? 'border-rose-400/50 bg-rose-500/10' : 'border-line hover:bg-tint/5',
          )}
        >
          <input
            type="radio"
            name={`reason-${kind}`}
            checked={value === r.id}
            onChange={() => onChange(r.id)}
            className="accent-rose-400"
          />
          {r.label}
        </label>
      ))}
    </fieldset>
  );
}
