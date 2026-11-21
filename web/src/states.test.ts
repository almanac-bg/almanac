// An answer's state (`.option.right`, `.option.amiss`, …) is never also a piece of its own: a rule for the class alone
// (`.missed { display: grid }`, a result's list) draws every answer in that state as that piece too, as it once drew a
// part of an order the player had out of place as a column of five lines.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** A selector list's selectors, split at its own commas (not those inside `:is(…)`). */
function split(list: string): string[] {
  const out = [""];
  let depth = 0;
  for (const c of list) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && !depth) out.push("");
    else out[out.length - 1] += c;
  }
  return out.map((s) => s.trim());
}

test("an answer's state class has no rule of its own", () => {
  for (const sheet of ["app.css", "outcome.css"]) {
    const css = readFileSync(new URL(`./${sheet}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/([^{};]+)\{/g)].flatMap((m) => split(m[1] ?? ""));
    const states = new Set(
      selectors.flatMap((s) => [...s.matchAll(/\.option((?:\.[\w-]+)+)/g)].flatMap((m) => m[1]?.split(".") ?? [])),
    );
    states.delete("");
    for (const s of selectors) {
      // The piece a selector draws: its last compound, from its last space or combinator on.
      const last = s.split(/[\s>+~]+/).at(-1) ?? "";
      const alone = /^\.([\w-]+)(?::[\w-]+(?:\([^)]*\))?)*$/.exec(last.replace(/::[\w-]+$/, ""));
      if (alone?.[1] && states.has(alone[1])) assert.fail(`${sheet}: „${s}“ styles .${alone[1]}, an answer's state`);
    }
  }
});
