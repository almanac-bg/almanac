/**
 * Time left, in words while it's long — „21 ч 56 мин“, „49 мин“ — and as a ticking clock only in its last ten minutes,
 * „4:12“: a clock for hours away („след 21:56:34“, next to „в 21:00“) read as a time of day.
 */
export function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  if (minutes >= 10) return `${minutes} мин`;
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
