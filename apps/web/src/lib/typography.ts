/**
 * Bulgarian typesetting: a number stays on the line with the word after it ("6 септември", "1885 г.", "10 въпроса",
 * "XIX век"), so a narrow screen never ends a line on "6" and starts the next with "септември". The bank's facts
 * carry these spaces already; questions and answers are shown through this.
 */
export function keepTogether(text: string): string {
  return text.replace(/(\d) (?=[\p{L}%°])/gu, '$1 ').replace(/\b([IVXLC]+) (?=век|в\.)/g, '$1 ');
}
