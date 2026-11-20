// The avatar's choice: how a player shows to others — an animal, in its own colours. Every animal is anyone's from the
// first day (play.Shapes): nothing to earn or unlock (DECISIONS.md, „The redesign“). On Профил (picker) and on a page of
// its own (/avatar, avatarChoice): each animal with its name, the one worn ringed; a tap wears it at once.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { api, back, errorText, h, signal, when, title, user, avatar, shapeNames, look, setLook } = {} as Kit;

export function avatarChoice(kit: Kit) {
  ({ api, back, errorText, h, signal, when, title, user, avatar, shapeNames, look, setLook } = kit);
  title("Аватар");
  return h(
    "section",
    { class: "screen" },
    back("/me", "Профил"),
    h("h1", null, "Аватар"),
    when(
      () => user(),
      () => choice(),
      () => h("p", { class: "lead" }, "Аватарът е твой от първата игра. Изиграй първите си въпроси."),
    ),
  );
}

/** The animals for Профил, each with its name, the one worn ringed (`kit`: the app's pieces, as the page opens). */
export function picker(kit: Kit): Child {
  ({ api, back, errorText, h, signal, when, title, user, avatar, shapeNames, look, setLook } = kit);
  return choice();
}

/** The animals, each in its own colours and with its name, the one worn ringed; a tap wears it at once (the frame's
 * and Профил's with it: state.ts, look). */
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
            {
              class: "pick",
              type: "button",
              "aria-pressed": () => s === (look() || "fox").split("-")[0],
              onclick: () => wear(`${s}-natural`),
            },
            avatar(s),
            h("span", { class: "pick-name" }, shapeNames[s]),
          ),
        ),
      ),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  ];
}
