// A name of the player's own, asked once: a player who never chose one shows to everyone as the name drawn for them
// („Щъркел 402“), on the day's board, in a duel, in Роял's lobby, in an invite's preview, and nobody remembers that.
// So the first moment they meet others asks, in a sheet over the page: one field, the drawn name in it to keep or
// change, the gold way on (the name saved, then on), „Не сега“ quiet (on with the drawn name: the name can wait, and
// Профил has it). Asked once on a device, whatever the answer, wherever it came:
//
//   - before others see them (nameFirst): a first live duel (screens/live.ts), going into Роял's lobby
//     (screens/royal.ts), taking a challenge or challenging a friend (screens/challenge.ts, screens/duel.ts). Never
//     in a room: a room asks for a name of its own, kept in the room (screens/room.ts). Esc or a tap beside the sheet
//     is „Не сега“ there: the player tapped to play, and the game goes on (put away with its screen, by going
//     elsewhere, it's no answer);
//   - before a first share or invite (askName), if not asked yet: what's shared carries the name. Esc or a tap beside
//     the sheet is no answer there: neither the share nor the question goes, and the next share asks.

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

/** A name in the shape the server takes (account.NormalName): its spaces made single, 2 to 30 letters, digits,
 * spaces, dots, dashes or underscores with a letter among them; "" if it isn't. The rest (one script a word, no web
 * address, nothing that reads as the game's own) is the server's to say, in its answer. */
export function normalName(s: string): string {
  const name = s.trim().replace(/\s+/g, " ");
  const n = [...name].length;
  if (n < 2 || n > 30 || !/^[\p{L}\p{N} ._-]+$/u.test(name) || !/\p{L}/u.test(name)) return "";
  return name;
}

/** Whether the player is to be asked: still with the name drawn for them, and not asked on this device. */
const toAsk = (u: User | null): u is User => !!u?.drawn && !asked(u.id);

/** Before a share by a player still with the name drawn for them, not asked yet on this device: the sheet, and true
 * (`share` goes from its gold button, once the name is saved, or from „Не сега“). Otherwise false: share at once. */
export function askName(share: () => void): boolean {
  const u = user.peek();
  if (!toAsk(u)) return false;
  sheet(u, {
    heading: "Как да те познаят приятелите?",
    lead: "С това име ще те видят в поканата и в играта. Можеш да го смениш и после.",
    go: "Сподели",
    next: share,
  });
  return true;
}

/** Before the player first meets others (a live duel, Роял, a challenge): the player made if they're not yet (a
 * first game), and, if they still have the name drawn for them and weren't asked on this device, the sheet first.
 * Done once it's answered, whichever way: true to go on, false if the player has gone to another screen meanwhile
 * (the router puts the sheet away with the screen). */
export async function nameFirst(): Promise<boolean> {
  const u = await player();
  if (!toAsk(u)) return true;
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
 * (`away`: Esc or a tap beside; none, nothing follows). */
function sheet(
  u: User,
  words: { heading: string; lead: string; go: string; next: () => void; away?: () => void },
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
          const name = normalName(input.value);
          if (!name) return say("Името е от 2 до 30 знака: букви, цифри, интервали, точки или тирета.");
          go.disabled = true;
          // Saved first, so that what follows has it (a share's preview, the duel's other side); but not waited on past
          // a second, so that a share still counts as the tap's (a browser lets a page share only then).
          if (name !== u.name) {
            const saved = api<{ user: User }>("PATCH", "/api/me", { name }).then((r) => user.set(r.user));
            const late = new Promise<void>((done) => setTimeout(done, 1000));
            try {
              await Promise.race([saved, late]);
            } catch (err) {
              go.disabled = false;
              return say(errorText(err));
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
    if (answered || !words.away) return;
    if (location.pathname === here) markAsked(u.id);
    words.away();
  });
  document.body.append(box);
  box.showModal();
  input.focus();
}
