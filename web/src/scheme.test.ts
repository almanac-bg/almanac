// Day is written twice in each stylesheet: for a light system (unless Night is chosen), and chosen whatever the system
// says (prefs.ts: scheme). The two must say the same, or Day chosen looks unlike Day by the device; and no rule may ask
// the system alone, or Night chosen on a light system would come out half Day.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const sheets = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".css"));

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** The rules of the block whose "{" ends at `from`, as selector → declarations (one level: rules hold no blocks). */
function rules(css: string, from: number): Map<string, string> {
  const out = new Map<string, string>();
  let at = from;
  for (;;) {
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", at);
    if (close < open || open < 0) return out; // the block's own end
    const selector = flat(css.slice(at, open).replace(/\/\*[\s\S]*?\*\//g, ""));
    const end = css.indexOf("}", open);
    out.set(selector, flat(css.slice(open + 1, end)));
    at = end + 1;
  }
}

for (const sheet of sheets) {
  const css = readFileSync(new URL(`./${sheet}`, import.meta.url), "utf8");
  const light = [...css.matchAll(/@media \(prefers-color-scheme: light\) \{/g)];

  test(`${sheet}: Day chosen is Day by the device`, () => {
    for (const m of light) {
      for (const [selector, body] of rules(css, (m.index ?? 0) + m[0].length)) {
        assert.match(selector, /:root:not\(\[data-scheme="night"\]\)/, `${sheet}: "${selector}" ignores Night chosen`);
        const chosen = selector.replaceAll(':root:not([data-scheme="night"])', ':root[data-scheme="day"]');
        const twins = [
          ...css.matchAll(new RegExp(`\\n  ${chosen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "g")),
        ];
        assert.ok(twins.length, `${sheet}: no "${chosen}" beside "${selector}"`);
        assert.ok(
          twins.some(([, b = ""]) => flat(b) === body),
          `${sheet}: "${chosen}" doesn't say what "${selector}" does`,
        );
      }
    }
  });
}
