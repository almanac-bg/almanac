// An invite link: someone asks you to be friends in the game. Accepting makes you friends at once (and a player, if
// you weren't yet); then a duel is a tap away.

import { shareButton } from "../game/results.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { player, user } from "../state.ts";

interface Info {
  by: string;
  own: boolean;
  friends: boolean;
}

export function invite([code = ""]: string[]) {
  title("Покана");
  const screen = signal<Child>(h("p", { class: "muted" }, "…"));
  const error = signal("");

  const friends = (name: string, id?: number): Child =>
    h(
      "section",
      { class: "screen" },
      h(
        "div",
        { class: "intro" },
        h("p", { class: "kicker" }, "Приятели"),
        h("h1", null, `Вече сте приятели с ${name}`),
        h("p", { class: "lead" }, "Виждате резултатите си за деня и се каните на дуел, на живо."),
      ),
      id
        ? h(
            "button",
            {
              class: "btn primary big",
              onclick: async () => {
                try {
                  const r = await api<{ code: string }>("POST", `/api/friends/${id}/duel`, {});
                  go(`/r/${r.code}`);
                } catch (err) {
                  error.set((err as ApiError).message);
                }
              },
            },
            "Покани на дуел",
          )
        : null,
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
      h("a", { class: "btn", href: "/together" }, "Към Заедно"),
    );

  const accept = async () => {
    error.set("");
    try {
      await player();
      const r = await api<{ id: number; name: string }>("POST", `/api/invites/${code}`, {});
      screen.set(friends(r.name, r.id));
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };

  api<Info>("GET", `/api/invites/${code}`).then(
    (info) => {
      if (info.own) {
        screen.set(
          h(
            "section",
            { class: "screen" },
            h(
              "div",
              { class: "intro" },
              h("p", { class: "kicker" }, "Покана"),
              h("h1", null, "Това е твоят линк"),
              h("p", { class: "lead" }, "Прати го на приятел: щом го отвори и приеме, ставате приятели."),
            ),
            shareButton("Прати линка", () => "Ела да сме приятели в АЛМАНАХ:", location.href),
          ),
        );
      } else if (info.friends) {
        screen.set(friends(info.by));
      } else {
        screen.set(
          h(
            "section",
            { class: "screen" },
            h(
              "div",
              { class: "intro" },
              h("p", { class: "kicker" }, "Покана"),
              h("h1", null, `${info.by} те кани за приятел`),
              h(
                "p",
                { class: "lead" },
                "Приятелите виждат резултатите си за деня и се канят на дуел, на живо: десет въпроса, един срещу друг.",
              ),
            ),
            h("button", { class: "btn primary big", onclick: accept }, "Приеми"),
            () => error() && h("p", { class: "bad", role: "alert" }, error()),
            user() ? null : h("p", { class: "muted" }, "Без регистрация: играеш веднага."),
          ),
        );
      }
    },
    (err: ApiError) =>
      screen.set(
        h(
          "section",
          { class: "screen" },
          h("h1", null, "Тази покана я няма"),
          h("p", { class: "lead" }, err.message),
          h("a", { class: "btn primary", href: "/together" }, "Към Заедно"),
        ),
      ),
  );
  return h("div", null, () => screen());
}
