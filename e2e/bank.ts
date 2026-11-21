// The questions the browser tests play: the public sample bank, and, where the real bank is here (private/, or the
// main checkout's from a worktree; never on CI, which has only the sample), the real bank's extremes with it, the
// questions a phone's short screen has the least room for (its longest orders, pairs and choices, and its longest choice
// under a portrait): the program serves them in a copy of the sample bank made for the tests (playwright.config,
// BANK_DIR), and kinds.ts finds them there as the longest of their kind, beside the sample's own.
import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** A question of the bank, as much of it as the tests read. */
export interface Q {
  id: string;
  type: string;
  text: string;
  answer?: unknown;
  wrong?: string[];
  image?: { file: string; w: number; h: number };
  pictures?: { alt: string }[];
  clues?: string[];
  items?: { text: string; value?: number; group?: number }[];
  direction?: string;
  pairs?: { left: string; right: string }[];
  decoy?: string;
  groups?: string[];
  tolerance?: number;
  retired?: unknown;
}

const root = resolve(import.meta.dirname, "..");
const sample = resolve(root, "bank/sample");
/** The real bank: this checkout's, or, in a worktree (a session's), the main checkout's; null where there's none. */
const real = ((): string | null => {
  const here = resolve(root, "private");
  if (existsSync(resolve(here, "questions"))) return here;
  try {
    // A worktree's .git is a file naming its place in the main checkout's: <main>/.git/worktrees/<name>.
    const dir = /^gitdir: (.+)$/m.exec(readFileSync(resolve(root, ".git"), "utf8"))?.[1]?.trim();
    const main = dir ? resolve(dir, "../../../private") : "";
    if (main && existsSync(resolve(main, "questions"))) return main;
  } catch {
    // .git a folder: the main checkout, whose private/ isn't here.
  }
  return null;
})();
/** The copy the program serves when the real bank is here. */
const served = resolve(root, "test-results/bank");

/** A bank's questions, file by file (a chapter's each). */
const files = (dir: string): Map<string, Q[]> =>
  new Map(
    readdirSync(resolve(dir, "questions"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f, JSON.parse(readFileSync(resolve(dir, "questions", f), "utf8")) as Q[]]),
  );

/** All the words a question shows: the longest of each kind is the one a screen has the least room for. */
export const words = (q: Q) =>
  [
    q.text,
    q.answer,
    q.wrong,
    q.clues,
    q.items?.map((i) => i.text),
    q.pairs?.flatMap((p) => [p.left, p.right]),
    q.decoy,
    q.groups,
  ]
    .flat()
    .filter((w) => typeof w === "string")
    .join(" ").length;

/** A choice under a picture taller than it's wide: the picture as tall as a question's picture is let be. */
export const portrait = (q: Q) => q.type === "choice" && !!q.image && q.image.h > 1.2 * q.image.w;

/** The real bank's questions the tests add to the sample: of an order and of pairs, the one with the most words and
 * the one with the longest question (often one question); the choice with the most words, and the one under a
 * portrait with the most; each with its chapter's file. None without the real bank. */
function picks(): [file: string, q: Q][] {
  if (!real) return [];
  const all = [...files(real)].flatMap(([f, qs]) => qs.filter((q) => !q.retired).map((q) => [f, q] as [string, Q]));
  const out = new Map<string, [string, Q]>();
  const most = (kind: (q: Q) => boolean, size: (q: Q) => number) => {
    const best = all.filter(([, q]) => kind(q)).sort(([, a], [, b]) => size(b) - size(a))[0];
    if (best) out.set(best[1].id, best);
  };
  for (const type of ["order", "match"])
    for (const size of [words, (q: Q) => q.text.length]) most((q) => q.type === type, size);
  most((q) => q.type === "choice" && !q.image && !q.pictures, words);
  most(portrait, words);
  return [...out.values()];
}

/** The bank the program serves to the tests: the sample, or, with the real bank here, a copy of it with the real
 * bank's longest orders and pairs (made once, by the main process: `make`). */
export function testBank(make: boolean): string {
  const add = picks();
  if (!add.length) return "bank/sample";
  if (make) {
    rmSync(served, { recursive: true, force: true });
    cpSync(sample, served, { recursive: true });
    const qs = files(served);
    const ids = new Set([...qs.values()].flat().map((q) => q.id));
    // Each waiting for a day far ahead (bank.Tail.On; play's `waiting`): dealt to a test by its id, never drawn by the
    // game, into a day's issue, a topic's game or a duel, so that whatever the tests play by chance is the sample's,
    // here as on CI.
    for (const [f, q] of add) if (!ids.has(q.id)) qs.set(f, [...(qs.get(f) ?? []), { ...q, on: ["2999-01-01"] } as Q]);
    for (const [f, list] of qs) writeFileSync(resolve(served, "questions", f), JSON.stringify(list, null, 2));
    // A picture's files with it, each width the program offers (its name, and -600, -900).
    const stems = new Set(add.flatMap(([, q]) => (q.image ? [q.image.file.replace(/\.[a-z]+$/, "")] : [])));
    for (const name of readdirSync(resolve(real ?? "", "images")))
      if (stems.has(name.replace(/(-\d+)?\.[a-z]+$/, "")))
        copyFileSync(resolve(real ?? "", "images", name), resolve(served, "images", name));
  }
  return "test-results/bank";
}

/** The sample's questions' ids: those of the tests' bank that a run on CI has too. */
export function sampleIds(): Set<string> {
  return new Set([...files(sample).values()].flat().map((q) => q.id));
}

/** The questions the tests' program serves (testBank's). */
export function bankQuestions(): Q[] {
  const dir = existsSync(resolve(served, "questions")) && picks().length ? served : sample;
  return [...files(dir).values()].flat();
}
