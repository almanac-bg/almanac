// The game's days and hours are Bulgaria's, whatever the device's clock says. Pure, so that it's tested with any date.

/** A moment's date in Bulgaria, as the server writes a day: 2026-11-14. */
export function dayInBulgaria(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (t: string) => String(Number(parts.find((p) => p.type === t)?.value)).padStart(2, "0");
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A moment's hour in Bulgaria (0–23). */
export function hourInBulgaria(now = new Date()): number {
  const hour = new Intl.DateTimeFormat("en", { timeZone: "Europe/Sofia", hour: "numeric", hourCycle: "h23" })
    .formatToParts(now)
    .find((p) => p.type === "hour")?.value;
  return Number(hour ?? 0);
}
