// An invite link (server/invite.go, play/invite.go), opened: /f/<code> becomes Днес, the invite over the day's issue
// (its cover, to a visitor not signed in): whose it is, with their avatar and seal, and „Добави като приятел“. One tap
// makes the two friends. A visitor who hasn't finished a game plays first: the tap is kept on this device (a week at
// most), and the link taken as their first game ends (takeWaiting, from game/run.ts), its line over the result. The
// address becomes Днес's, so that a reload, or the address copied from the bar, is the day's and not the invite's.

import { ApiError, api, errorText } from "../lib/api.ts";
import { boot } from "../lib/boot.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { go } from "../lib/router.ts";
import { withWord } from "../lib/words.ts";
import { user } from "../state.ts";
import { avatar, type Look, worn } from "../ui.ts";

/** An invite as its opener sees it (play.Invite): whose it is, and whether it's the opener's own, or a friend's
 * already. */
interface Invite extends Look {
  code: string;
  name: string;
  tag: string;
  mine?: boolean;
  friends?: boolean;
}

/** What Днес shows of an invite opened: the invite, or that the link isn't one (any more). */
type Opened = Invite | { gone: true };

/** The invite the page was opened at, until Днес has taken it (inviteCard). */
let opened: Opened | null = null;

/** An invite link (/f/<code>), opened: its invite, as the page came with it or asked for, then Днес. */
export function invited([code = ""]: string[]): Child {
  const inPage = boot.invite as (Partial<Invite> & { gone?: boolean }) | undefined;
  boot.invite = undefined;
  if (inPage?.gone) {
    opened = { gone: true };
    go("/", true);
    return null;
  }
  if (inPage?.code === code) {
    opened = inPage as Invite;
    go("/", true);
    return null;
  }
  api<Invite>("GET", `/api/invites/${code}`).then(
    (inv) => {
      opened = inv;
      go("/", true);
    },
    () => {
      opened = { gone: true };
      go("/", true);
    },
  );
  return h("p", { class: "muted" }, "…");
}

/** Where a tap on an invite waits for the player's first game, on this device: its code and when it was tapped. */
const waitingKey = "almanac.invite";
const waitingFor = 7 * 24 * 60 * 60 * 1000;

function keepWaiting(code: string): void {
  try {
    localStorage.setItem(waitingKey, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // no storage here: the link opened again does it
  }
}

function waiting(): string {
  try {
    const w = JSON.parse(localStorage.getItem(waitingKey) ?? "null") as { code?: string; at?: number } | null;
    if (w?.code && Date.now() - (w.at ?? 0) < waitingFor) return w.code;
    localStorage.removeItem(waitingKey);
  } catch {
    // nothing kept
  }
  return "";
}

function dropWaiting(): void {
  try {
    localStorage.removeItem(waitingKey);
  } catch {
    // nothing kept
  }
}

/** What came of an invite taken after the player's first game, said once over Днес's result. */
export const inviteSaid = signal("");

let taking: Promise<void> | null = null;

/** Takes the invite waiting for the player's first game, if one does: once a game has ended. Still too early (the
 * game wasn't the first to count yet) it waits on; anything else ends it, said once. */
export function takeWaiting(): Promise<void> {
  const code = waiting();
  if (!code || !user.peek()) return Promise.resolve();
  taking ??= api<{ name: string }>("POST", `/api/invites/${code}`)
    .then(
      (r) => {
        dropWaiting();
        inviteSaid.set(`Вече сте приятели ${withWord(r.name)}.`);
      },
      (err) => {
        if (err instanceof ApiError && err.code === "play_first") return;
        dropWaiting();
        inviteSaid.set(errorText(err));
      },
    )
    .finally(() => {
      taking = null;
    });
  return taking;
}

/** The invite opened at the page (once: a later Днес is the day's alone), or what came of one taken after a game,
 * over Днес. */
export function inviteCard(): Child {
  const o = opened;
  opened = null;
  if (!o) {
    // Said once: gone as the screen goes.
    onCleanup(() => inviteSaid.set(""));
    return () => (inviteSaid() ? h("p", { class: "notice", role: "status" }, inviteSaid()) : null);
  }
  if ("gone" in o) return h("p", { class: "notice", role: "status" }, "Тази покана вече не важи. Поискай нова връзка.");
  const inv = o;
  // What the card says under the name, once there's something to say: the two are friends, or the add waits.
  const said = signal<{ text: string; bad?: boolean; done?: boolean } | null>(
    inv.mine
      ? { text: "Това е твоята покана. Който я отвори, може да те добави с едно докосване." }
      : inv.friends
        ? { text: `Вече сте приятели ${withWord(inv.name)}.`, done: true }
        : null,
  );
  const busy = signal(false);
  const playFirst = () => {
    keepWaiting(inv.code);
    said.set({ text: `Първо изиграй днешния брой. След него ще сте приятели ${withWord(inv.name)}.` });
  };
  const add = async () => {
    // Not a player yet: nobody to be friends with until their first game.
    if (!user.peek()) return playFirst();
    busy.set(true);
    try {
      const r = await api<{ name: string }>("POST", `/api/invites/${inv.code}`);
      dropWaiting();
      said.set({ text: `Вече сте приятели ${withWord(r.name)}.`, done: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "play_first") playFirst();
      else said.set({ text: errorText(err), bad: true });
    } finally {
      busy.set(false);
    }
  };
  return h(
    "section",
    { class: "invite-card", "aria-label": "Покана за приятелство" },
    avatar(inv.avatar, { name: inv.name }),
    h(
      "div",
      { class: "invite-text" },
      h("p", { class: "invite-name" }, h("strong", null, inv.name), worn(inv.seal)),
      () => {
        const s = said();
        if (!s) return h("p", { class: "invite-line" }, "те кани да сте приятели в АЛМАНАХ.");
        return h(
          "p",
          { class: s.bad ? "invite-line bad" : "invite-line", role: s.bad ? "alert" : "status" },
          s.text,
          s.done ? [" ", h("a", { class: "invite-go", href: "/friends" }, "Към Приятели")] : null,
        );
      },
    ),
    () => {
      const s = said();
      if (inv.mine || s?.done || (s && !s.bad)) return null;
      return h("button", { class: "btn inline", type: "button", disabled: busy, onclick: add }, "Добави като приятел");
    },
  );
}
