// Words that change with the word after them, as Bulgarian says them.

/** „с“ or „със“ before a name: „със“ before an с or a з, in either alphabet („със Заек 817“, „с Мечка 12“). */
export function withName(name: string): string {
  return `${/^([сз]|[sz](?!h))/i.test(name) ? "със" : "с"} ${name}`;
}
