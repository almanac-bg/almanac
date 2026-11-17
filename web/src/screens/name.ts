// Your name before you share: a player who never chose one shares as the name drawn for them („Мечка 164 иска да
// сте приятели“, the link's preview „Мечка 164 в АЛМАНАХ“), which nobody they send it to knows. So the first share or
// invite by such a player asks once, in a sheet over the page: one field, the drawn name in it to keep or change,
// „Сподели“ gold (the name saved, then the share), „Не сега“ quiet. Asked once on a device, whatever the answer.

import { type ApiError, api } from "../lib/api.ts";
import { h } from "../lib/dom.ts";
import { type User, user } from "../state.ts";

/** Where the players asked on this device are kept. */
const askedKey = "almanac.nameAsked";

function asked(id: number): boolean {
  try {
    return (localStorage.getItem(askedKey) ?? "").split(",").includes(String(id));
  } catch {
    return false; // no storage here: asked each time, which a name chosen ends anyway
  }
}

function markAsked(id: number): void {
  try {
    const was = (localStorage.getItem(askedKey) ?? "").split(",").filter(Boolean);
    localStorage.setItem(askedKey, [...was, String(id)].slice(-10).join(","));
  } catch {
    // not kept: asked again next time
  }
}

/** Names the server keeps for itself (account.reserved). */
const reserved = new Set([
  "алманах",
  "almanac",
  "admin",
  "админ",
  "администратор",
  "administrator",
  "support",
  "help",
  "root",
  "system",
]);

/** A name as the server would take it (account.NormalName): its spaces made single, 2 to 30 letters, digits, spaces,
 * dots, dashes or underscores with a letter among them, and not one it keeps; "" if it wouldn't. */
export function normalName(s: string): string {
  const name = s.trim().replace(/\s+/g, " ");
  const n = [...name].length;
  if (n < 2 || n > 30 || !/^[\p{L}\p{N} ._-]+$/u.test(name) || !/\p{L}/u.test(name)) return "";
  return reserved.has(name.toLowerCase()) ? "" : name;
}

/** Before a share by a player still with the name drawn for them, not asked yet on this device: the sheet, and true
 * (`share` goes from its gold button, once the name is saved). Otherwise false: share at once. */
export function askName(share: () => void): boolean {
  const u = user.peek();
  if (!u?.drawn || asked(u.id)) return false;
  sheet(u, share);
  return true;
}

function sheet(u: User, share: () => void): void {
  const input = h("input", {
    name: "name",
    autocomplete: "name",
    maxlength: 30,
    value: u.name,
    onfocus: (e: FocusEvent) => (e.target as HTMLInputElement).select(),
  });
  const error = h("p", { class: "bad", role: "alert", hidden: true });
  const go = h("button", { class: "btn primary big" }, "Сподели");
  const box = h(
    "dialog",
    { class: "sheet", "aria-labelledby": "name-sheet-title" },
    h(
      "form",
      {
        class: "card sheet-panel stack",
        onsubmit: async (e: SubmitEvent) => {
          e.preventDefault();
          const name = normalName(input.value);
          if (!name) return say("Името е от 2 до 30 букви, цифри или интервали.");
          go.disabled = true;
          // Saved first, so that the link's preview already has it; but not waited on past a second, so the share
          // still counts as the tap's (a browser lets a page share only then).
          if (name !== u.name) {
            const saved = api<{ user: User }>("PATCH", "/api/me", { name }).then((r) => user.set(r.user));
            const late = new Promise<void>((done) => setTimeout(done, 1000));
            try {
              await Promise.race([saved, late]);
            } catch (err) {
              go.disabled = false;
              return say((err as ApiError).message);
            }
          }
          markAsked(u.id);
          box.close();
          share();
        },
      },
      h("h2", { id: "name-sheet-title" }, "Как да те познаят приятелите?"),
      h("p", { class: "muted" }, "С това име ще те видят в поканата и в играта. Можеш да го смениш и после."),
      h("label", { class: "field" }, h("span", null, "Име"), input),
      error,
      go,
      h("button", { class: "link tap sheet-skip", type: "button", onclick: () => box.close() }, "Не сега"),
    ),
  );
  const say = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };
  // A tap beside the sheet puts it away, as Esc does.
  box.addEventListener("click", (e) => {
    if (e.target === box) box.close();
  });
  box.addEventListener("close", () => box.remove());
  document.body.append(box);
  box.showModal();
  input.focus();
}
