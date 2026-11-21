// The avatar's choice: how a player shows to others. Every animal is anyone's from the first day (play.Shapes); a
// chapter's art is the player's from the chapter's Страница (play/rank.go), and until then shows hollow, with when it
// opens under its name. On Профил (picker), its one place: each with its name, the one worn ringed; a tap wears it at
// once, and on one not the player's yet says how far it is.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { api, artFrom, errorText, h, inSight, signal, avatar, shapeNames, look, setLook, categories, chapterName } =
  {} as Kit;

/** A chapter's rank, as the book has it: its art is the player's from level 2 (Страница); its ink as counted. */
interface Rank {
  chapter: string;
  level: number;
  ink?: number;
}

function setKit(kit: Kit) {
  ({ api, artFrom, errorText, h, inSight, signal, avatar, shapeNames, look, setLook, categories, chapterName } = kit);
}

/** The avatars for Профил (`kit`: the app's pieces, as the page opens; `ranks`: the player's, as Профил has them). */
export function picker(kit: Kit, ranks: () => Rank[]): Child {
  setKit(kit);
  return choice(ranks);
}

/** The animals, each in its own colours, then the chapters' art, each with its name; the one worn ringed; a tap wears
 * it at once (the frame's and Профил's with it: state.ts, look). A chapter's art not the player's yet is hollow, „при
 * „Страница““ under its name, and can't be worn: a tap on it says how far it is, with the real count of ink left. */
function choice(ranks: () => Rank[]): Child {
  const error = signal("");
  // What a tap on art not the player's yet said: how far it is.
  const why = signal("");
  const wear = async (id: string) => {
    error.set("");
    why.set("");
    const was = look();
    setLook(id); // at once: the server says no only to what isn't one
    try {
      const r = await api<{ avatar: string }>("PATCH", "/api/me/look", { avatar: id });
      setLook(r.avatar);
    } catch (err) {
      setLook(was);
      error.set(errorText(err));
    }
  };
  const worn = (s: string) => s === (look() || "fox");
  return [
    h(
      "ul",
      { class: "picker" },
      Object.keys(shapeNames).map((s) =>
        h(
          "li",
          null,
          h(
            "button",
            { class: "pick", type: "button", "aria-pressed": () => worn(s), onclick: () => wear(s) },
            avatar(s),
            h("span", { class: "pick-name" }, shapeNames[s]),
          ),
        ),
      ),
      categories.map((c) =>
        h("li", null, () => {
          const rank = ranks().find((r) => r.chapter === c.id);
          const open = (rank?.level ?? 0) >= 2;
          const left = artFrom - (rank?.ink ?? 0);
          const tell = () =>
            why.set(
              `Картината на ${chapterName(c.id)} става твоя при печата „Страница“${left > 0 ? `: още ${left} с\u00a0мастило` : ""}.`,
            );
          return h(
            "button",
            {
              class: open ? "pick" : "pick locked",
              type: "button",
              "aria-pressed": () => worn(c.id),
              onclick: () => (open ? wear(c.id) : tell()),
            },
            avatar(c.id),
            h("span", { class: "pick-name" }, chapterName(c.id)),
            // When it opens, where it's seen.
            open ? null : h("span", { class: "pick-when" }, "при „Страница“"),
          );
        }),
      ),
    ),
    () => why() && h("p", { class: "small pick-why", role: "status", ref: inSight }, why()),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  ];
}
