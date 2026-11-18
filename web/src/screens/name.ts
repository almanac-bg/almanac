// A name of the player's own, asked once: a player who never chose one shows to everyone as the name drawn for them
// („Щъркел 402“), on the day's board, in a duel, in Роял's lobby, in an invite's preview, and nobody remembers that.
// So the first moment they meet others asks, in a sheet over the page: one field, the drawn name in it to keep or
// change, the gold way on (the name saved, then on), „Не сега“ quiet (on with the drawn name: the name can wait, and
// Профил has it). Asked once on a device, whatever the answer, wherever it came:
//
//   - before others see them (nameFirst): a first live duel (screens/live.ts: before a new search, never on coming
//     back to a duel under way nor for a rematch), going into Роял's lobby (screens/royal.ts), taking a challenge or
//     challenging a friend (screens/challenge.ts, screens/duel.ts). Never in a room: a room asks for a name of its
//     own, kept in the room (screens/room.ts). The name is saved before the game goes on (the others see it), and one
//     refused is said in the sheet, to change. Esc or a tap beside the sheet is „Не сега“ there: the player tapped to
//     play, and the game goes on (put away with its screen, by going elsewhere, it's no answer). One sheet at a time:
//     a second ask while it's up (a double tap) waits for the same answer;
//   - before a first share or invite (askName), if not asked yet: what's shared carries the name. The name's saving is
//     waited on a second at most (a browser lets a page share only just after the tap): one refused later is said
//     then, in the sheet again, to change. Esc or a tap beside the sheet is no answer there: neither the share nor the
//     question goes, and the next share asks.

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
    quick: true,
  });
  return true;
}

/** The ask under way for nameFirst, and the answer it will give: a second ask meanwhile waits for it. */
let asking: Promise<boolean> | null = null;

/** Before the player first meets others (a live duel, Роял, a challenge): the player made if they're not yet (a
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
 * (`away`: Esc or a tap beside; none, nothing follows). `quick`: the name's saving is waited on a second at most (a
 * share). `name` and `error`: what the field holds, and what's wrong with it (a name refused after the share). */
function sheet(
  u: User,
  words: {
    heading: string;
    lead: string;
    go: string;
    next: () => void;
    away?: () => void;
    quick?: boolean;
    name?: string;
    error?: string;
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
    value: words.name ?? u.name,
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
          if (name !== u.name) {
            go.disabled = true;
            // Saved first, so that what follows has it (the duel's other side, a share's preview); a share waits a
            // second at most, so that it still counts as the tap's (a browser lets a page share only then), and a name
            // refused after that is said then, in the sheet again.
            const refused = api<{ user: User }>("PATCH", "/api/me", { name }).then(
              (r) => void user.set(r.user),
              (err) => errorText(err),
            );
            const late = new Promise<null>((done) => setTimeout(() => done(null), 1000));
            const why = await (words.quick ? Promise.race([refused, late]) : refused);
            if (why) {
              go.disabled = false;
              return say(why);
            }
            if (why === null) refused.then((then) => then && refusedLate(u, name, then));
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
  if (words.error) say(words.error);
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

/** A name given before a share, refused after it went (with the name the player had): said in the sheet, to change.
 * The share isn't sent again. */
function refusedLate(u: User, name: string, why: string): void {
  if (user.peek()?.id !== u.id) return; // signed out meanwhile
  sheet(u, {
    heading: "Името не е запазено",
    lead: "Поканата тръгна с името, което имаше досега. Опитай с друго.",
    go: "Запази",
    next: () => {},
    name,
    error: why,
  });
}
