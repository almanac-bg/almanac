// Friends, in Заедно: the duels they ask you to now, each friend with their day and your record against them, and
// your invite link to make more.

import { shareButton } from "../game/results.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { go } from "../lib/router.ts";
import { type Invitation, invitations, player, user } from "../state.ts";
import { avatar } from "../ui.ts";

interface Friend {
  id: number;
  name: string;
  avatar?: string;
  title?: string;
  level?: number;
  today?: { points: number; rights: number };
  won: number;
  lost: number;
  drawn: number;
}

interface Friends {
  invite: string;
  friends: Friend[];
  invites: Invitation[];
}

export function friendsCard(): Child {
  const data = signal<Friends | null>(null);
  const error = signal("");
  const editing = signal(false);

  const load = async () => {
    if (!user.peek()) return;
    try {
      const f = await api<Friends>("GET", "/api/friends");
      data.set(f);
      invitations.set(f.invites);
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  load();
  // Invitations come and go (a friend asks, gives up, the time runs out): look again while the screen is open.
  const every = setInterval(() => {
    if (!document.hidden) load();
  }, 15_000);
  onCleanup(() => clearInterval(every));

  const act = async (fn: () => Promise<unknown>) => {
    error.set("");
    try {
      await fn();
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  const duel = (f: Friend) =>
    act(async () => go(`/r/${(await api<{ code: string }>("POST", `/api/friends/${f.id}/duel`, {})).code}`));
  const decline = (i: Invitation) =>
    act(async () => {
      await api("POST", `/api/rooms/${i.code}/decline`, {}).catch(() => {}); // gone already: nothing to turn down
      await load();
    });
  const remove = (f: Friend) =>
    act(async () => {
      await api("DELETE", `/api/friends/${f.id}`);
      await load();
    });

  return h(
    "section",
    { class: "card friends" },
    h("div", { class: "card-head" }, h("h2", null, "Приятели"), () =>
      data()?.friends.length
        ? h("button", { class: "link muted", type: "button", onclick: () => editing.update((e) => !e) }, () =>
            editing() ? "Готово" : "Промени",
          )
        : null,
    ),
    () =>
      (data()?.invites ?? []).map((i) =>
        h(
          "div",
          { class: "invitation" },
          h("p", null, h("strong", null, i.from), " те кани на дуел."),
          h(
            "div",
            { class: "invitation-actions" },
            h("a", { class: "btn rose inline", href: `/r/${i.code}` }, "Приеми"),
            h("button", { class: "link", type: "button", onclick: () => decline(i) }, "Откажи"),
          ),
        ),
      ),
    () => {
      const d = data();
      if (!d) {
        // Not a player yet: the link is made once they are.
        return user()
          ? null
          : [
              h(
                "p",
                { class: "muted" },
                "Покани приятели: виждате резултатите си за деня и се каните на дуел, на живо.",
              ),
              h(
                "button",
                {
                  class: "btn",
                  type: "button",
                  onclick: () =>
                    act(async () => {
                      await player();
                      await load();
                    }),
                },
                "Покани приятел",
              ),
            ];
      }
      return [
        d.friends.length
          ? h(
              "ol",
              { class: "friend-list" },
              d.friends.map((f) =>
                row(
                  f,
                  () => duel(f),
                  () => remove(f),
                  editing,
                ),
              ),
            )
          : h(
              "p",
              { class: "muted" },
              "Още нямаш приятели тук. Прати им линка си: щом го отворят и приемат, ставате приятели.",
            ),
        shareButton("Покани приятел", () => "Ела да сме приятели в АЛМАНАХ:", d.invite, false),
        h(
          "p",
          { class: "muted small" },
          "Линкът ти: ",
          h("a", { href: new URL(d.invite).pathname, class: "invite-link" }, d.invite),
        ),
      ];
    },
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** A friend: their name, their day, the duels between you, and a duel now (or, while editing, removing them). */
function row(f: Friend, duel: () => void, remove: () => void, editing: () => boolean): Child {
  const played = f.won + f.lost + f.drawn;
  return h(
    "li",
    { class: "friend" },
    avatar(f.avatar, { level: f.level, name: f.name }),
    h(
      "div",
      { class: "friend-text" },
      h("strong", { class: "friend-name" }, f.name),
      f.title ? h("span", { class: "who-title" }, f.title) : null,
      h(
        "span",
        { class: "friend-day" },
        f.today ? `Днес: ${f.today.rights}/10 · ${f.today.points} т.` : "Днес още няма резултат",
      ),
    ),
    played
      ? h(
          "span",
          {
            class: "record",
            title: `Дуели помежду ви: ${f.won} победи, ${f.lost} загуби${f.drawn ? `, ${f.drawn} равни` : ""}`,
          },
          h("span", { class: "sr" }, "Дуели: "),
          `${f.won} : ${f.lost}`,
        )
      : null,
    () =>
      editing()
        ? h("button", { class: "link muted", type: "button", onclick: remove }, "Премахни")
        : h("button", { class: "btn inline", type: "button", onclick: duel }, "Дуел"),
  );
}
