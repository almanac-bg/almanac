// How the player's friends did with each of the day's questions, in its questions gone over (results.ts, reviewSheet:
// play.FriendsOn): the words, apart from how they're drawn. „Знаят“ is said as the game counts it, right answers only:
// a „близо“ on the number isn't one, and the words say „позна“, never „знае“ (DESIGN.md, Copy).

import { listWords } from "../lib/words.ts";

/** A friend's game of the day, beside its questions (play.FriendDay): who, and each of the ten in the issue's order as
 * a share says it ('1' right, '2' близо, '0' wrong or not answered, '3' one that counts for nobody); their face
 * without the seal, which covered it that small. */
export interface FriendDay {
  name: string;
  avatar?: string;
  marks: string;
}

/** How a question went for a friend, by its place among the ten (from 0). */
export function markAt(f: FriendDay, n: number): "right" | "close" | "wrong" | "void" {
  return ({ "1": "right", "2": "close", "3": "void" } as const)[f.marks[n] as "1"] ?? "wrong";
}

/** Up to how many friends a question names one by one; more, and they're two rows, those who got it and those who
 * didn't, each opened to its list. */
export const fewFriends = 4;

/** A name as a short line says it: its first word („Стоян“ of „Стоян Тодоров“), but whole where the next word is a
 * number („Лисица 936“: the animal alone names nobody). */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length > 1 && /^\d+$/.test(words[1] ?? "") ? `${words[0]} ${words[1]}` : (words[0] ?? "");
}

/** The line over a question's friends (`knew`: the names of those who got it right, best first; `all`: how many
 * finished the day): how many got it; none, said as none; with many friends and only one to three right, those few by
 * name. Nothing for one friend, whose sign beside the name says it all. */
export function friendsLine(knew: string[], all: number): string | null {
  if (all < 2) return null;
  const k = knew.length;
  if (k === 0) return "Никой от приятелите ти не го позна.";
  if (all > fewFriends && k <= 3)
    return `От ${all} твои приятели го ${k === 1 ? "позна" : "познаха"} само ${listWords(knew)}.`;
  return `Вярно ${k === 1 ? "отговаря" : "отговарят"} ${k} от ${all} твои приятели.`;
}

/** A row of many friends, by name: up to three, or the first two and how many more („Niki, Йордан и още\u00a015“). */
export function groupWords(names: string[]): string {
  const short = names.map(shortName);
  return short.length <= 3 ? listWords(short) : `${short[0]}, ${short[1]} и още\u00a0${short.length - 2}`;
}
