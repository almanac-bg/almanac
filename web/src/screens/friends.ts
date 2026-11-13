// Friends, in Заедно: the duels they ask you to now, who asks to be friends, each friend with their day and your
// record against them, and the ways to make more: by their tag or email, or your invite link.

import { shareButton } from "../game/results.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { go } from "../lib/router.ts";
import { friendRequests, type Invitation, invitations, player, user } from "../state.ts";
import { avatar, type Tier } from "../ui.ts";

interface Friend {
  id: number;
  name: string;
  tag: string;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
  today?: { points: number; rights: number };
  won: number;
  lost: number;
  drawn: number;
}

/** A friend request: from someone (to you), or to someone or an email address (from you). */
interface Request {
  id: number;
  name?: string;
  tag?: string;
  email?: string;
}

interface Friends {
  invite: string;
  friends: Friend[];
  invites: Invitation[];
  requests: { in: Request[]; out: Request[] };
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
      friendRequests.set(f.requests.in.length);
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
  const accept = (r: Request) =>
    act(async () => {
      await api("POST", `/api/friends/requests/${r.id}/accept`, {});
      await load();
    });
  const drop = (r: Request) =>
    act(async () => {
      await api("DELETE", `/api/friends/requests/${r.id}`);
      await load();
    });
  // Made once: what it says after a request stays while the list around it is drawn again.
  const adder = addFriend(load);

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
      (data()?.requests.in ?? []).map((r) =>
        h(
          "div",
          { class: "invitation" },
          h(
            "p",
            null,
            h("strong", null, r.name),
            h("span", { class: "muted" }, ` @${r.tag}`),
            " иска да сте приятели.",
          ),
          h(
            "div",
            { class: "invitation-actions" },
            h("button", { class: "btn rose inline", type: "button", onclick: () => accept(r) }, "Приеми"),
            h("button", { class: "link", type: "button", onclick: () => drop(r) }, "Откажи"),
          ),
        ),
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
          : h("p", { class: "muted" }, "Още нямаш приятели тук. Добави ги по таг или имейл, или им прати линка си."),
        adder,
        d.requests.out.length
          ? h(
              "div",
              { class: "stack small-gap" },
              h("p", { class: "kicker" }, "Чакат отговор"),
              h(
                "ul",
                { class: "waiting" },
                d.requests.out.map((r) =>
                  h(
                    "li",
                    null,
                    r.email
                      ? h("span", null, r.email)
                      : h("span", null, r.name, h("span", { class: "muted" }, ` @${r.tag}`)),
                    h("button", { class: "link muted", type: "button", onclick: () => drop(r) }, "Отмени"),
                  ),
                ),
              ),
            )
          : null,
        shareButton("Покани с линк", () => "Ела да сме приятели в АЛМАНАХ:", d.invite, false),
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

/** Asking someone to be friends: by their tag (@tag) or their email. */
function addFriend(reload: () => Promise<void>): Child {
  const to = signal("");
  const busy = signal(false);
  const note = signal<{ text: string; bad?: boolean } | null>(null);
  return h(
    "form",
    {
      class: "add-friend",
      onsubmit: async (e: SubmitEvent) => {
        e.preventDefault();
        const who = to.peek().trim();
        if (!who) return;
        busy.set(true);
        note.set(null);
        try {
          const r = await api<{ friends?: boolean; name?: string }>("POST", "/api/friends/requests", { to: who });
          const byEmail = who.includes("@") && !who.startsWith("@");
          note.set({
            text: r.friends
              ? `Вече сте приятели с ${r.name}.`
              : byEmail
                ? "Поканата е изпратена. Ако има играч с този имейл, ще я види в Заедно."
                : `Поканата до ${r.name} е изпратена.`,
          });
          to.set("");
          await reload();
        } catch (err) {
          note.set({ text: (err as ApiError).message, bad: true });
        } finally {
          busy.set(false);
        }
      },
    },
    h(
      "label",
      { class: "field" },
      h("span", null, "Добави приятел"),
      h(
        "span",
        { class: "add-friend-row" },
        h("input", {
          name: "to",
          "aria-label": "Таг или имейл на приятел",
          placeholder: "@таг или имейл",
          autocomplete: "off",
          autocapitalize: "none",
          spellcheck: false,
          maxlength: 254,
          required: true,
          value: to,
          oninput: (e: Event) => to.set((e.target as HTMLInputElement).value),
        }),
        h("button", { class: "btn inline", disabled: busy }, "Покани"),
      ),
    ),
    () => {
      const n = note();
      return n && h("p", { class: n.bad ? "bad" : "muted", role: "status" }, n.text);
    },
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
      h("strong", { class: "friend-name" }, f.name, h("span", { class: "friend-tag" }, ` @${f.tag}`)),
      f.title ? h("span", { class: `who-title t-${f.titleTier ?? "common"}` }, f.title) : null,
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
