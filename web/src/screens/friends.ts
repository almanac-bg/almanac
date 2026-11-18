// Friends (Приятели): who asks to be friends, each friend with their day and your record against them, and the ways to
// make more: by their tag or email, or your invite link (a new one at a tap, the old one then nobody's). Anyone who
// asks, or a friend, can be blocked from here: they're gone, and can't ask again (play/blocks.go); the blocked are
// listed last, to lift it.

import type { Kit } from "../kit.ts";
import type { Child, Signal } from "../lib/dom.ts";
import type { Tier } from "../ui.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  shareButton,
  api,
  errorText,
  h,
  onCleanup,
  signal,
  when,
  go,
  title,
  friendRequests,
  player,
  user,
  avatar,
  failure,
  formatNumber,
  pageArt,
  profileHref,
  record,
} = {} as Kit;

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
  requests: { in: Request[]; out: Request[] };
  blocked: { name: string; tag: string }[];
}

/** Приятели, one of the main places. */
export function friends(kit: Kit): Child {
  ({
    shareButton,
    api,
    errorText,
    h,
    onCleanup,
    signal,
    when,
    go,
    title,
    friendRequests,
    player,
    user,
    avatar,
    failure,
    formatNumber,
    pageArt,
    profileHref,
    record,
  } = kit);
  title("Приятели");
  return h("section", { class: "screen" }, friendsCard());
}

/** The page's title (with the way to change the list, once there are friends), then the friends card itself. */
function friendsCard(): Child {
  const data = signal<Friends | null>(null);
  const error = signal("");
  // The list that couldn't load (with nothing of it shown yet): the failure, and the way to try again.
  const failed = signal<unknown>(null);
  const editing = signal(false);
  // Asking whether to make a new invite link: kept here, so that the list drawn again (every 15 s) doesn't drop it.
  const asking = signal(false);

  const load = async () => {
    if (!user.peek()) return;
    try {
      const f = await api<Friends>("GET", "/api/friends");
      failed.set(null);
      data.set(f);
      friendRequests.set(f.requests.in.length);
    } catch (err) {
      // A look again that failed, with the list on the screen, waits for the next one quietly.
      if (!data.peek()) failed.set(err);
    }
  };
  load();
  // Friend requests come and go (someone asks, or takes it back): look again while the screen is open.
  const every = setInterval(() => {
    if (!document.hidden) load();
  }, 15_000);
  onCleanup(() => clearInterval(every));

  const act = async (fn: () => Promise<unknown>) => {
    error.set("");
    try {
      await fn();
    } catch (err) {
      error.set(errorText(err));
    }
  };
  // A friend challenged: ten played now, and they play theirs when they can.
  const challenge = (f: Friend) => act(async () => go(`/challenge/${f.id}`));
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
  const block = (tag: string) =>
    act(async () => {
      await api("POST", "/api/blocks", { tag });
      await load();
    });
  const unblock = (tag: string) =>
    act(async () => {
      await api("DELETE", `/api/blocks/${tag}`);
      await load();
    });
  const renew = () =>
    act(async () => {
      const r = await api<{ invite: string }>("POST", "/api/friends/invite", {});
      const d = data.peek();
      if (d) data.set({ ...d, invite: r.invite });
    });
  // Made once: what it says after a request stays while the list around it is drawn again.
  const adder = addFriend(load);

  return [
    pageArt("friends", "tone-rose"),
    h("div", { class: "title-row" }, h("h1", null, "Приятели"), () =>
      data()?.friends.length
        ? h("button", { class: "link muted", type: "button", onclick: () => editing.update((e) => !e) }, () =>
            editing() ? "Готово" : "Промени",
          )
        : null,
    ),
    h(
      "section",
      { class: "card friends" },
      () =>
        (data()?.requests.in ?? []).map((r) =>
          h(
            "div",
            { class: "invitation" },
            h(
              "p",
              null,
              r.tag ? h("a", { href: profileHref(r.tag) }, h("strong", null, r.name)) : h("strong", null, r.name),
              h("span", { class: "muted" }, ` @${r.tag}`),
              " иска да сте приятели.",
            ),
            h(
              "div",
              { class: "invitation-actions" },
              h("button", { class: "btn rose inline", type: "button", onclick: () => accept(r) }, "Приеми"),
              h("button", { class: "link", type: "button", onclick: () => drop(r) }, "Откажи"),
              r.tag
                ? h("button", { class: "link muted", type: "button", onclick: () => block(r.tag ?? "") }, "Блокирай")
                : null,
            ),
          ),
        ),
      () => {
        const d = data();
        if (!d && failed()) return failure(failed(), () => void load());
        if (!d) {
          // Not a player yet: the link is made once they are.
          return user()
            ? null
            : [
                h(
                  "p",
                  { class: "muted" },
                  "Покани приятели: ще виждате резултатите си за деня и ще се предизвиквате на дуел.",
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
                    () => challenge(f),
                    () => remove(f),
                    () => block(f.tag),
                    editing,
                  ),
                ),
              )
            : [
                h(
                  "p",
                  { class: "muted" },
                  "Още нямаш приятели тук. Прати им покана или ги добави по потребителско име или имейл.",
                ),
                // No friends yet: the invitation is the one thing to do here, gold, first.
                invite(d.invite, true, renew, asking),
              ],
        ];
      },
      // Outside the blocks drawn again on each look (every 15 s): drawn again, its field would lose the focus mid-word.
      when(data, () => adder),
      () => {
        const d = data();
        if (!d) return null;
        return [
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
                        : h(
                            "a",
                            { href: profileHref(r.tag ?? "") },
                            r.name,
                            h("span", { class: "muted" }, ` @${r.tag}`),
                          ),
                      h("button", { class: "link muted", type: "button", onclick: () => drop(r) }, "Отмени"),
                    ),
                  ),
                ),
              )
            : null,
          d.friends.length ? invite(d.invite, false, renew, asking) : null,
          d.blocked.length
            ? h(
                "div",
                { class: "stack small-gap" },
                h("p", { class: "kicker" }, "Блокирани"),
                h(
                  "ul",
                  { class: "waiting" },
                  d.blocked.map((b) =>
                    h(
                      "li",
                      null,
                      h("span", null, b.name, h("span", { class: "muted" }, ` @${b.tag}`)),
                      h("button", { class: "link muted", type: "button", onclick: () => unblock(b.tag) }, "Отблокирай"),
                    ),
                  ),
                ),
              )
            : null,
        ];
      },
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    ),
  ];
}

/** The player's invitation, by the phone's share sheet (or copied: „Копирано.“), never printed as a raw address; gold
 * while there are no friends yet. The link itself is on the element for the browser tests (`data-invite`). Under it,
 * a new link in its place (`renew`), asked once more first: every link sent or shared before stops working. */
function invite(url: string, primary: boolean, renew: () => Promise<void>, asking: Signal<boolean>): Child {
  return h(
    "div",
    { class: "invite stack small-gap", "data-invite": new URL(url).pathname },
    shareButton("Покани с връзка", () => "Ела да сме приятели в АЛМАНАХ:", url, primary, undefined, true),
    () =>
      asking()
        ? h(
            "div",
            { class: "invite-renew", role: "group", "aria-label": "Нова връзка за покана" },
            h(
              "p",
              { class: "muted small invite-renew-note" },
              "Старата връзка ще спре да работи, включително в споделените ти резултати.",
            ),
            h(
              "div",
              { class: "invitation-actions" },
              h(
                "button",
                {
                  class: "btn inline",
                  type: "button",
                  onclick: async () => {
                    await renew();
                    asking.set(false);
                  },
                },
                "Направи нова",
              ),
              h("button", { class: "link tap", type: "button", onclick: () => asking.set(false) }, "Отказ"),
            ),
          )
        : h(
            "button",
            { class: "link muted small tap invite-new", type: "button", onclick: () => asking.set(true) },
            "Нова връзка за покана",
          ),
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
                ? "Поканата е изпратена. Ако има играч с този имейл, ще я види в играта."
                : `Поканата до ${r.name} е изпратена.`,
          });
          to.set("");
          await reload();
        } catch (err) {
          note.set({ text: errorText(err), bad: true });
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
          "aria-label": "Потребителско име или имейл на приятел",
          placeholder: "@име или имейл",
          autocomplete: "off",
          autocapitalize: "none",
          spellcheck: false,
          maxlength: 254,
          required: true,
          value: to,
          oninput: (e: Event) => to.set((e.target as HTMLInputElement).value),
        }),
        h("button", { class: "btn inline", disabled: busy }, "Добави"),
      ),
    ),
    () => {
      const n = note();
      return n && h("p", { class: n.bad ? "bad" : "muted", role: "status" }, n.text);
    },
  );
}

/** A friend: their name, their day, the duels between you, and a challenge now (or, while editing, removing or blocking
 * them). */
function row(f: Friend, challenge: () => void, remove: () => void, block: () => void, editing: () => boolean): Child {
  const played = f.won + f.lost + f.drawn;
  return h(
    "li",
    { class: "friend" },
    avatar(f.avatar, { level: f.level, name: f.name }),
    h(
      "div",
      { class: "friend-text" },
      h(
        "a",
        { class: "friend-name", href: profileHref(f.tag) },
        f.name,
        h("span", { class: "friend-tag" }, ` @${f.tag}`),
      ),
      f.title ? h("span", { class: `who-title t-${f.titleTier ?? "common"}` }, f.title) : null,
      h(
        "span",
        { class: "friend-day" },
        f.today ? `${f.today.rights} от 10 · ${formatNumber(f.today.points)} т.` : "Днес още няма резултат",
      ),
    ),
    played
      ? h(
          "span",
          {
            class: "record",
            title: `Дуели помежду ви: ${record(f.won, f.lost, f.drawn)}`,
          },
          h("span", { class: "sr" }, "Дуели: "),
          `${f.won} : ${f.lost}`,
        )
      : null,
    () =>
      editing()
        ? h(
            "span",
            { class: "invitation-actions friend-act" },
            h("button", { class: "link muted", type: "button", onclick: remove }, "Премахни"),
            h("button", { class: "link muted", type: "button", onclick: block }, "Блокирай"),
          )
        : h("button", { class: "btn inline friend-act", type: "button", onclick: challenge }, "Предизвикай"),
  );
}
