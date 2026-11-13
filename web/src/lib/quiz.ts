// How the player wants a topic run: how many questions, how hard, which kinds, and how much time. Kept in the browser
// like the other settings; the server checks them and keeps them with the run.

import { signal } from "./dom.ts";

export type Difficulty = "" | "easy" | "medium" | "hard";
export type Kind = "choice" | "truefalse" | "number" | "order" | "match";

export interface Quiz {
  length: 5 | 10 | 15;
  /** "" follows the player's level. */
  difficulty: Difficulty;
  /** None for every kind. */
  kinds: Kind[];
  slow: boolean;
}

export const lengths = [5, 10, 15] as const;
export const difficulties: Difficulty[] = ["", "easy", "medium", "hard"];
export const kinds: Kind[] = ["choice", "truefalse", "number", "order", "match"];

export const standard: Quiz = { length: 10, difficulty: "", kinds: [], slow: false };

const key = "almanac.quiz";

function read(): Quiz {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Quiz> | null;
    if (!v) return standard;
    const picked = (v.kinds ?? []).filter((k) => kinds.includes(k));
    return {
      length: lengths.includes(v.length as Quiz["length"]) ? (v.length as Quiz["length"]) : 10,
      difficulty: difficulties.includes(v.difficulty as Difficulty) ? (v.difficulty as Difficulty) : "",
      kinds: picked.length === kinds.length ? [] : kinds.filter((k) => picked.includes(k)),
      slow: v.slow === true,
    };
  } catch {
    return standard; // storage refused, or something else in it: the standard run
  }
}

/** The player's settings for topic runs. */
export const quiz = signal<Quiz>(read());

export function setQuiz(change: Partial<Quiz>): void {
  const next = { ...quiz.peek(), ...change };
  if (next.kinds.length === kinds.length) next.kinds = [];
  next.kinds = kinds.filter((k) => next.kinds.includes(k));
  quiz.set(next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Not kept: the choice holds for this visit.
  }
}

export const isStandard = (q: Quiz) => q.length === 10 && !q.difficulty && !q.kinds.length && !q.slow;

/** Turns a kind on or off. From every kind, a kind picked is the only one; turning off the last one goes back to
 * every kind. */
export function toggleKind(k: Kind): void {
  const now = quiz.peek().kinds;
  if (!now.length) setQuiz({ kinds: [k] });
  else setQuiz({ kinds: now.includes(k) ? now.filter((x) => x !== k) : [...now, k] });
}

/** The settings as the server takes them. */
export function forServer(q: Quiz): Record<string, unknown> {
  return { length: q.length, difficulty: q.difficulty, kinds: q.kinds, slow: q.slow };
}

export const lengthWords: Record<Quiz["length"], string> = { 5: "пет", 10: "десет", 15: "петнадесет" };

export const difficultyWords: Record<Difficulty, string> = {
  "": "По моето ниво",
  easy: "Лесни",
  medium: "Средни",
  hard: "Трудни",
};

export const kindWords: Record<Kind, string> = {
  choice: "С избор",
  truefalse: "Вярно или не",
  number: "С число",
  order: "Подреждане",
  match: "Свързване",
};

/** The settings in a line: „10 въпроса · по моето ниво · всички видове · обичайно време“. */
export function summaryOf(q: Quiz): string {
  return [
    `${q.length} въпроса`,
    difficultyWords[q.difficulty].toLowerCase(),
    q.kinds.length ? q.kinds.map((k) => kindWords[k].toLowerCase()).join(", ") : "всички видове",
    q.slow ? "двойно време" : "обичайно време",
  ].join(" · ");
}
