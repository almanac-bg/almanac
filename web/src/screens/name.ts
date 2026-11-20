// A name of the player's own, asked once: a player who never chose one shows to everyone as the name drawn for them
// („Щъркел 402“), on the day's board, in a duel, and nobody remembers that. So the first moment they
// meet others asks, in a sheet over the page: one field, the drawn name in it to keep or change, the gold way on (the
// name saved, then on), „Не сега“ quiet (on with the drawn name: the name can wait, and Профил has it). Asked once on
// a device, whatever the answer, before others see them (nameFirst): a first live duel (screens/live.ts: before a new
// search, never on coming back to a duel under way nor for a rematch).
// The name is saved before the game goes on (the others see it), and one refused is said in the sheet, to change. Esc
// or a tap beside the sheet is „Не сега“: the player tapped to play, and the game goes on (put away with its screen,
// by going elsewhere, it's no answer). One sheet at a time: a second ask while it's up (a double tap) waits for the same answer.

import { api, errorText } from "../lib/api.ts";
import { h } from "../lib/dom.ts";
import { player, type User, user } from "../state.ts";

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

/** Whether the player is to be asked: still with the name drawn for them, and not asked on this device. */
const toAsk = (u: User | null): u is User => !!u?.drawn && !asked(u.id);

/** The ask under way for nameFirst, and the answer it will give: a second ask meanwhile waits for it. */
let asking: Promise<boolean> | null = null;

/** Before the player first meets others (a live duel): the player made if they're not yet (a
 * first game), and, if they still have the name drawn for them and weren't asked on this device, the sheet first.
 * Done once it's answered, whichever way (a name given, once saved): true to go on, false if the player has gone to
 * another screen meanwhile (the router puts the sheet away with the screen). `without`, asked only when the sheet
 * would show, says whether to go on without it all the same (a duel already under way, come back to). */
export function nameFirst(without?: () => Promise<boolean>): Promise<boolean> {
  asking ??= ask(without).finally(() => {
    asking = null;
  });
  return asking;
}

async function ask(without?: () => Promise<boolean>): Promise<boolean> {
  const u = await player();
  if (!toAsk(u) || (without && (await without()))) return true;
  const here = location.pathname;
  return new Promise((done) =>
    sheet(u, {
      heading: "Как да те виждат останалите?",
      lead: "С това име ще те виждат в класациите и в игрите с други. Можеш да го смениш и после.",
      go: "Готово",
      next: () => done(true),
      away: () => done(location.pathname === here),
    }),
  );
}

/** The sheet: its words, its gold button's, what follows an answer (`next`), and what a way out without one does
 * (`away`: Esc or a tap beside). */
function sheet(
  u: User,
  words: {
    heading: string;
    lead: string;
    go: string;
    next: () => void;
    away: () => void;
  },
): void {
  let answered = false;
  const answer = () => {
    answered = true;
    markAsked(u.id);
    box.close();
    words.next();
  };
  const input = h("input", {
    name: "name",
    autocomplete: "nickname",
    maxlength: 30,
    value: u.name,
    onfocus: (e: FocusEvent) => (e.target as HTMLInputElement).select(),
  });
  const error = h("p", { class: "bad", role: "alert", hidden: true });
  const go = h("button", { class: "btn primary big" }, words.go);
  const box = h(
    "dialog",
    { class: "sheet", "aria-labelledby": "name-sheet-title" },
    h(
      "form",
      {
        class: "card sheet-panel stack",
        onsubmit: async (e: SubmitEvent) => {
          e.preventDefault();
          // Its spaces made single, as the server keeps it. Whether the game takes it is the server's to say, in the
          // words it says the rule in everywhere (account's names).
          const name = input.value.trim().replace(/\s+/g, " ");
          if (name !== u.name) {
            go.disabled = true;
            // Saved first, so that what follows has it (the duel's other side).
            const why = await api<{ user: User }>("PATCH", "/api/me", { name }).then(
              (r) => void user.set(r.user),
              (err) => errorText(err),
            );
            if (why) {
              go.disabled = false;
              return say(why);
            }
          }
          answer();
        },
      },
      h("h2", { id: "name-sheet-title" }, words.heading),
      h("p", { class: "muted" }, words.lead),
      h("label", { class: "field" }, h("span", null, "Име"), input),
      error,
      go,
      h("button", { class: "link tap sheet-skip", type: "button", onclick: answer }, "Не сега"),
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
  // Put away by the router, with the screen it was asked on: not an answer.
  const here = location.pathname;
  box.addEventListener("close", () => {
    box.remove();
    if (answered) return;
    if (location.pathname === here) markAsked(u.id);
    words.away();
  });
  document.body.append(box);
  box.showModal();
  input.focus();
}
