// The avatar's choice: how a player shows to others. An avatar is a face, so an animal, every one anyone's from the
// first day (play.Shapes); never a seal, on it or as it (DECISIONS.md). A choice made rarely, so it's a
// sheet over Профил (pickAvatar), opened by the player's own avatar or „Смени“ under it, never a part of the page: the
// animals, each with its name, the one worn ringed; a tap wears it, and once it's kept the sheet goes.

import type { Kit } from "../kit.ts";

// The app's pieces, set as the sheet opens: it loads on its own, with Профил (kit.ts), and imports only types.
let { api, errorText, h, signal, avatar, shapeNames, look, setLook } = {} as Kit;

/** The avatars on a sheet over Профил (`kit`: the app's pieces). A tap wears one at once (the bar's and Профил's with
 * it: state.ts, look) and, once the server has kept it, puts the sheet away; refused, the one worn before is back and
 * the sheet says why. Esc, „Затвори“ or a tap beside it puts it away. */
export function pickAvatar(kit: Kit): void {
  ({ api, errorText, h, signal, avatar, shapeNames, look, setLook } = kit);
  const error = signal("");
  const close = () => box.close();
  const wear = async (id: string) => {
    error.set("");
    const was = look();
    setLook(id); // at once: the server says no only to what isn't one
    try {
      const r = await api<{ avatar: string }>("PATCH", "/api/me/look", { avatar: id });
      setLook(r.avatar);
      close();
    } catch (err) {
      setLook(was);
      error.set(errorText(err));
    }
  };
  const worn = (s: string) => s === (look() || "fox");
  const box = h(
    "dialog",
    { class: "sheet avatar-sheet", "aria-labelledby": "avatar-title" },
    h(
      "div",
      { class: "sheet-panel" },
      h(
        "div",
        { class: "sheet-head" },
        h("h2", { id: "avatar-title" }, "Аватар"),
        h("button", { class: "link", type: "button", onclick: close }, "Затвори"),
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
              { class: "pick", type: "button", "aria-pressed": () => worn(s), onclick: () => wear(s) },
              avatar(s),
              h("span", { class: "pick-name" }, shapeNames[s]),
            ),
          ),
        ),
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    ),
  ) as HTMLDialogElement;
  // A tap beside the sheet puts it away, as Esc does; put away, it goes (the router closes it with the screen).
  box.addEventListener("click", (e) => {
    if (e.target === box) close();
  });
  box.addEventListener("close", () => box.remove());
  document.body.append(box);
  box.showModal();
  // The one worn in sight, on a sheet that scrolls (a small phone, large text); the focus stays on „Затвори“, the
  // sheet's first control, so a tap doesn't ring the one worn twice.
  box.querySelector('.pick[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
}
