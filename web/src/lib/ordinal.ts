// Ordinals in digits, as Bulgarian writes them (the official orthographic dictionary): the ending after a hyphen, one
// letter or two depending on how the word ends — 1-ви, 2-ри, 3-ти, 4-ти, 5-и … 11-и … 21-ви, 100-тен, 1000-ен.

const endings = {
  m: ["ви", "ри", "ти", "и", "тен", "ен"],
  f: ["ва", "ра", "та", "а", "тна", "на"],
  n: ["во", "ро", "то", "о", "тно", "но"],
};

/** `n` as an ordinal; `kind` is the gender of what it counts: „място“ is "n" („3-то място“). */
export function ordinal(n: number, kind: keyof typeof endings = "m"): string {
  const tens = n % 100;
  let i = 3;
  if (n > 0 && n % 1000 === 0) i = 5;
  else if (n > 0 && tens === 0) i = 4;
  else if (tens < 11 || tens > 19) i = [3, 0, 1, 2, 2][n % 10] ?? 3;
  const digits = new Intl.NumberFormat("bg", { useGrouping: n >= 10000 }).format(n);
  return `${digits}-${endings[kind][i]}`;
}

/** A player's place among others, said of the place so that it reads the same to everyone: „3-то място от 10“. */
export const place = (n: number, of: number) => `${ordinal(n, "n")} място от ${of}`;
