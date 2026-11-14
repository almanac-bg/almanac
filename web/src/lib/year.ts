// When a year's look back („Твоята 2026“) is open: from 15 December, in Bulgaria; Начало offers it until 15 January,
// Профил keeps it after. Pure, so that it's tested with any date.

/** A moment's date in Bulgaria: its year, month and day. */
function inBulgaria(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** The year whose look back is open at a moment (0 before the first, 2026's), and whether it's fresh: from 15
 * December to 15 January, when Начало offers it. */
export function yearNow(now = new Date()): { year: number; fresh: boolean } {
  const { y, m, d } = inBulgaria(now);
  const open = m === 12 && d >= 15;
  const year = open ? y : y - 1;
  return { year: year >= 2026 ? year : 0, fresh: open || (m === 1 && d <= 15) };
}
