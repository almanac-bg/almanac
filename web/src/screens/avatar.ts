// The avatar's choice (/avatar, from Профил): how a player shows to others — an animal in a colour. Every animal and
// every colour is anyone's from the first day (play.Animals, play.Tones): nothing to earn or unlock (DECISIONS.md,
// „The redesign“). What's worn shows at the top as others see it; a tap on a colour or an animal wears it at once.

import type { Kit } from "../kit.ts";
import type { Child, Signal } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { api, back, errorText, h, signal, when, title, user, avatar, shapeNames, toneNames, loadStats } = {} as Kit;

export function avatarChoice(kit: Kit) {
  ({ api, back, errorText, h, signal, when, title, user, avatar, shapeNames, toneNames, loadStats } = kit);
  title("Аватар");
  return h(
    "section",
    { class: "screen" },
    back("/me", "Профил"),
    h("h1", null, "Аватар"),
    when(
      () => user(),
      () => {
        const worn = signal<string | null>(null);
        loadStats().then(
          (s) => worn.set(s.avatar),
          () => worn.set(""),
        );
        return choice(worn);
      },
      () => h("p", { class: "lead" }, "Аватарът е твой от първата игра. Изиграй първите си въпроси."),
    ),
  );
}

/** What's worn, as others see it; then the colours, and the animals in the colour worn. */
function choice(worn: Signal<string | null>): Child {
  const error = signal("");
  const wear = async (id: string) => {
    error.set("");
    const was = worn();
    worn.set(id); // at once: the server says no only to what isn't one
    try {
      const r = await api<{ avatar: string }>("PATCH", "/api/me/look", { avatar: id });
      worn.set(r.avatar);
    } catch (err) {
      worn.set(was);
      error.set(errorText(err));
    }
  };
  return () => {
    const id = worn();
    if (id === null) return h("p", { class: "muted" }, "…");
    const [shape = "fox", tone = "gold"] = (id || "fox-gold").split("-");
    return [
      h(
        "div",
        { class: "card worn" },
        avatar(id || undefined, { size: "l", name: user.peek()?.name }),
        h("div", { class: "worn-text" }, h("strong", { class: "worn-name" }, user.peek()?.name ?? "")),
      ),
      h(
        "div",
        { class: "tones", role: "group", "aria-label": "Цвят" },
        Object.keys(toneNames).map((t) =>
          h("button", {
            class: `tone-pick tone-${t}`,
            type: "button",
            "aria-pressed": t === tone,
            "aria-label": `Цвят: ${toneNames[t]}`,
            onclick: () => wear(`${shape}-${t}`),
          }),
        ),
      ),
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
                "aria-pressed": s === shape,
                "aria-label": shapeNames[s],
                onclick: () => wear(`${s}-${tone}`),
              },
              avatar(`${s}-${tone}`),
            ),
          ),
        ),
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    ];
  };
}
