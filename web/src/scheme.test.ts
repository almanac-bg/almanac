// A look not the first is written twice in each stylesheet: for a system set to it (unless the other is chosen), and
// chosen whatever the system says (prefs.ts: scheme). Night is app.css's second look (Day, paper, is its first); the
// admin's page is the other way round. The two must say the same, or Night chosen looks unlike Night by the device;
// and no rule may ask the system alone, or Day chosen on a dark system would come out half Night.
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

/** The look a system's setting asks for, as the page names it when chosen (data-scheme), and the other one. */
const looks = { light: ["day", "night"], dark: ["night", "day"] } as const;

for (const sheet of sheets) {
  const css = readFileSync(new URL(`./${sheet}`, import.meta.url), "utf8");
  const blocks = [...css.matchAll(/@media \(prefers-color-scheme: (light|dark)\) \{/g)];

  test(`${sheet}: a look chosen is the look by the device`, () => {
    for (const m of blocks) {
      const [look, other] = looks[m[1] as "light" | "dark"];
      const unlessOther = `:root:not([data-scheme="${other}"])`;
      for (const [selector, body] of rules(css, (m.index ?? 0) + m[0].length)) {
        assert.ok(selector.includes(unlessOther), `${sheet}: "${selector}" ignores ${other} chosen`);
        const chosen = selector.replaceAll(unlessOther, `:root[data-scheme="${look}"]`);
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
