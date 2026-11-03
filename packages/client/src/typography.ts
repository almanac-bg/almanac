/**
 * Bulgarian typesetting: a number stays on the line with the word after it ("6 септември", "1885 г.", "10 въпроса",
 * "XIX век"), so a narrow screen never ends a line on "6" and starts the next with "септември"; a dash stays with the
 * word before it. The bank's facts carry the numbers' spaces already; questions, answers and facts are shown through
 * this.
 */
export function keepTogether(text: string): string {
  return (
    text
      .replace(/(\d) (?=[\p{L}%°])/gu, '$1 ')
      .replace(/\b([IVXLC]+) (?=век|в\.)/g, '$1 ')
      // „най-“ and „по-“ stay with their word („Кой е най-“ / „едрият…“ broke there): a word joiner after the hyphen,
      // which is invisible and forbids the break.
      .replace(/(^|[^\p{L}])(най|по)-(?=\p{L})/giu, '$1$2-\u2060')
      // A spaced dash ends a line, never starts one („в Европа“ / „— първите…“).
      .replace(/ (?=[—–] )/g, '\u00a0')
  );
}
