// Words that change with the word after them, as Bulgarian says them.

/** „с“ or „със“ before a name: „със“ before an с or a з, in either alphabet („със Заек 817“, „с Мечка 12“). */
export function withName(name: string): string {
  return `${/^([сз]|[sz](?!h))/i.test(name) ? "със" : "с"} ${name}`;
}

/** On a day of the week, as Bulgarian says it: „в събота“, „във вторник“ (`day` YYYY-MM-DD). */
export function onDay(day: string): string {
  const name = new Intl.DateTimeFormat("bg", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return `${/^[вф]/i.test(name) ? "във" : "в"} ${name}`;
}
