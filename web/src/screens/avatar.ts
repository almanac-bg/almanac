// The avatar's choice: how a player shows to others. An avatar is a face, so an animal, every one anyone's from the
// first day (play.Shapes); a seal is worn on it, never chosen as it (DECISIONS.md). On Профил (picker), its one place:
// each with its name, the one worn ringed; a tap wears it at once.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { api, errorText, h, signal, avatar, shapeNames, look, setLook } = {} as Kit;

/** The avatars for Профил (`kit`: the app's pieces, as the page opens). */
export function picker(kit: Kit): Child {
  ({ api, errorText, h, signal, avatar, shapeNames, look, setLook } = kit);
  return choice();
}

/** The animals, each in its own colours, with its name; the one worn ringed; a tap wears it at once (the bar's and
 * Профил's with it: state.ts, look). */
function choice(): Child {
  const error = signal("");
  const wear = async (id: string) => {
    error.set("");
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
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  ];
}
