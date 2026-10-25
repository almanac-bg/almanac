/** "1-во", "2-ро", "3-то", "7-мо"… (neuter, as in "място") */
export function ordinal(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (tens >= 11 && tens <= 19) return `${n}-то`;
  if (last === 1) return `${n}-во`;
  if (last === 2) return `${n}-ро`;
  if (last === 7 || last === 8) return `${n}-мо`;
  return `${n}-то`;
}
