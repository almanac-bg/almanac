// The avatar's choice: how a player shows to others. Every animal is anyone's from the first day (play.Shapes); a
// chapter's art is the player's from the chapter's Страница (play/rank.go), and until then shows hollow, „от
// Страница“. On Профил (picker) and on a page of its own (/avatar, avatarChoice): each with its name, the one worn
// ringed; a tap wears it at once.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { api, back, errorText, h, signal, when, title, user, avatar, shapeNames, look, setLook, categories, chapterName } =
  {} as Kit;

/** A chapter's rank, as the book has it: its art is the player's from level 2 (Страница). */
interface Rank {
  chapter: string;
  level: number;
}

function setKit(kit: Kit) {
  ({ api, back, errorText, h, signal, when, title, user, avatar, shapeNames, look, setLook, categories, chapterName } =
    kit);
}

export function avatarChoice(kit: Kit) {
  setKit(kit);
  title("Аватар");
  const ranks = signal<Rank[]>([]);
  const tag = user.peek()?.tag;
  if (tag)
    api<{ ranks?: Rank[] }>("GET", `/api/players/${encodeURIComponent(tag)}`).then(
      (p) => ranks.set(p.ranks ?? []),
      () => {},
    );
  return h(
    "section",
    { class: "screen" },
    back("/me", "Профил"),
    h("h1", null, "Аватар"),
    when(
      () => user(),
      () => choice(ranks),
      () => h("p", { class: "lead" }, "Аватарът е твой от първата игра. Изиграй първите си въпроси."),
    ),
  );
}

/** The avatars for Профил (`kit`: the app's pieces, as the page opens; `ranks`: the player's, as Профил has them). */
export function picker(kit: Kit, ranks: () => Rank[]): Child {
  setKit(kit);
  return choice(ranks);
}

/** The animals, each in its own colours, then the chapters' art, each with its name; the one worn ringed; a tap wears
 * it at once (the frame's and Профил's with it: state.ts, look). A chapter's art not the player's yet is hollow, „от
 * Страница“, and can't be worn. */
function choice(ranks: () => Rank[]): Child {
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
  const worn = (s: string) => s === (look() || "fox").split("-")[0];
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
            { class: "pick", type: "button", "aria-pressed": () => worn(s), onclick: () => wear(`${s}-natural`) },
            avatar(s),
            h("span", { class: "pick-name" }, shapeNames[s]),
          ),
        ),
      ),
      categories.map((c) =>
        h("li", null, () => {
          const open = (ranks().find((r) => r.chapter === c.id)?.level ?? 0) >= 2;
          return h(
            "button",
            {
              class: open ? "pick" : "pick locked",
              type: "button",
              "aria-pressed": () => worn(c.id),
              "aria-disabled": open ? null : "true",
              "aria-label": open ? chapterName(c.id) : `${chapterName(c.id)}: от Страница`,
              onclick: () => (open ? wear(`${c.id}-natural`) : null),
            },
            avatar(`${c.id}-natural`),
            h("span", { class: "pick-name" }, open ? chapterName(c.id) : "от Страница"),
          );
        }),
      ),
    ),
    h("p", { class: "small" }, "Картината на всяка глава става твой аватар от печата Страница."),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  ];
}
