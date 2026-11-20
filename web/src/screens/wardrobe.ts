// Гардероб: how a player looks to others — the avatar (an animal or an emblem, in a colour), its frame and the pattern
// behind it, and the title under their name. What they wear now shows at the top as others see it; below, one group at
// a time, what's theirs to choose from, then what's still locked: each with what unlocks it and how far along they
// are, the nearest first, the rest folded away.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Cosmetic, Lock, Progress, TitleView } from "./progress.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  errorText,
  h,
  signal,
  when,
  title,
  user,
  avatar,
  profileNav,
  shapeNames,
  tierWords,
  toneNames,
  loadProgress,
  meter,
} = {} as Kit;

type Part = "avatar" | "frame" | "backdrop" | "title";

const parts: [Part, string][] = [
  ["avatar", "Аватар"],
  ["frame", "Рамка"],
  ["backdrop", "Фон"],
  ["title", "Титла"],
];

/** The groups of titles still locked, as headed. */
const titleGroups: [TitleView["group"], string][] = [
  ["level", "С нивата"],
  ["days", "С дните с въпросите на деня"],
  ["achievement", "С постиженията"],
  ["topic", "С майсторството в темите"],
  ["rank", "С рейтинга и Роял"],
];

export function wardrobe(kit: Kit) {
  ({
    api,
    errorText,
    h,
    signal,
    when,
    title,
    user,
    avatar,
    profileNav,
    shapeNames,
    tierWords,
    toneNames,
    loadProgress,
    meter,
  } = kit);
  title("Гардероб");
  return h(
    "section",
    { class: "screen" },
    () => (user() ? profileNav() : null),
    // Профил's switch names the place: the heading is for screen readers then.
    h("h1", { class: () => (user() ? "sr" : "") }, "Гардероб"),
    when(
      () => user(),
      () => {
        const progress = signal<Progress | null>(null);
        const load = () => loadProgress().then(progress.set, () => {});
        load();
        return look(progress, load);
      },
      () => h("p", { class: "lead" }, "Аватарите, рамките и титлите идват с играта. Изиграй първите си въпроси."),
    ),
  );
}

/** What's worn, as others see it, then the switch between the groups and the one shown. */
function look(progress: () => Progress | null, reload: () => Promise<void>): Child {
  const part = signal<Part>("avatar");
  const error = signal("");
  const set = async (body: { avatar?: string; title?: string; frame?: string; backdrop?: string }) => {
    error.set("");
    try {
      await api("PATCH", "/api/me/look", body);
      await reload();
    } catch (err) {
      error.set(errorText(err));
    }
  };
  return () => {
    const p = progress();
    if (!p) return h("p", { class: "muted" }, "…");
    const worn = p.title ? p.titles.find((t) => t.id === p.title) : undefined;
    return [
      h(
        "div",
        { class: "card worn" },
        avatar(p.avatar, { size: "l", level: p.level, frame: p.frame, backdrop: p.backdrop }),
        h(
          "div",
          { class: "worn-text" },
          h("strong", { class: "worn-name" }, user()?.name ?? ""),
          worn
            ? h("span", { class: `me-title t-${worn.tier}` }, worn.name)
            : h("span", { class: "muted small" }, p.titleByLevel ? "Още без титла" : "Без титла"),
        ),
      ),
      h(
        "div",
        { class: "segmented", role: "tablist", "aria-label": "Какво да смениш" },
        parts.map(([id, text]) =>
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": () => part() === id,
              onclick: () => part.set(id),
            },
            text,
          ),
        ),
      ),
      () => {
        switch (part()) {
          case "avatar":
            return avatars(p, set);
          case "frame":
            return wear(
              p,
              p.frames,
              p.frame,
              "Без рамка",
              (id) => avatar(p.avatar, { frame: id, backdrop: p.backdrop }),
              (id) => set({ frame: id }),
            );
          case "backdrop":
            return wear(
              p,
              p.backdrops,
              p.backdrop,
              "Едноцветен",
              (id) => avatar(p.avatar, { frame: p.frame, backdrop: id }),
              (id) => set({ backdrop: id }),
            );
          case "title":
            return titles(p, set);
        }
      },
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    ];
  };
}

/** The avatar: its colour, then the pictures that are the player's (the animals, and those unlocked), then those
 * still locked. */
function avatars(p: Progress, set: (body: { avatar: string }) => void): Child {
  const [shape = "", tone = ""] = p.avatar.split("-");
  return [
    h(
      "div",
      { class: "tones", role: "group", "aria-label": "Цвят" },
      p.tones.map((t) =>
        h("button", {
          class: `tone-pick tone-${t}`,
          type: "button",
          "aria-pressed": t === tone,
          "aria-label": `Цвят: ${toneNames[t]}`,
          onclick: () => set({ avatar: `${shape}-${t}` }),
        }),
      ),
    ),
    h(
      "ul",
      { class: "picker" },
      p.shapes
        .filter((s) => !s.locked)
        .map((s) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                class: "pick",
                type: "button",
                "aria-pressed": s.shape === shape,
                "aria-label": shapeNames[s.shape],
                onclick: () => set({ avatar: `${s.shape}-${tone}` }),
              },
              avatar(`${s.shape}-${tone}`),
            ),
          ),
        ),
    ),
    locks(
      p,
      p.shapes.filter((s) => s.locked).map((s) => ({ ...s, name: shapeNames[s.shape] ?? s.shape })),
      (s) => avatar(`${s.shape}-${tone}`),
    ),
  ];
}

/** A frame or a pattern: each drawn on the player's avatar, those still locked after. */
function wear(
  p: Progress,
  all: Cosmetic[],
  worn: string,
  none: string,
  preview: (id: string) => Child,
  put: (id: string) => void,
): Child {
  return [
    h(
      "ul",
      { class: "picker" },
      [{ id: "", name: none } as Cosmetic, ...all.filter((c) => !c.locked)].map((c) =>
        h(
          "li",
          null,
          h(
            "button",
            {
              class: "pick",
              type: "button",
              "aria-pressed": c.id === worn,
              "aria-label": c.name,
              onclick: () => put(c.id),
            },
            preview(c.id),
          ),
        ),
      ),
    ),
    locks(
      p,
      all.filter((c) => c.locked),
      (c) => preview(c.id),
    ),
  ];
}

/** How many of the locked show before the rest are folded away. */
const nearest = 3;

/** How far along a player is to unlocking something, from 0 to 1: the level, or the achievement's progress (a hidden
 * one, or one without a measure, 0). */
function along(p: Progress, l: Lock): number {
  if (l.level) return Math.min(p.level / l.level, 1);
  const a = l.achievement ? p.achievements.find((x) => x.id === l.achievement) : undefined;
  if (!a || a.hidden) return 0;
  return Math.min((a.progress ?? 0) / (a.goal ?? 1), 1);
}

/** What's still locked, the nearest first, each with what unlocks it and how far along the player is; past the first
 * few, folded away. */
function locks<T extends Lock & { name: string }>(p: Progress, list: T[], preview: (x: T) => Child): Child {
  if (!list.length) return null;
  const sorted = list
    .map((x, i) => ({ x, i, far: along(p, x) }))
    .sort((a, b) => b.far - a.far || a.i - b.i)
    .map((y) => y.x);
  const rows = (items: T[]) =>
    h(
      "ul",
      { class: "achievements" },
      items.map((x) =>
        h("li", { class: "achievement locked" }, h("span", { class: "lock-art" }, preview(x)), lockText(p, x)),
      ),
    );
  return [
    h("h2", { class: "titles-more" }, "За отключване"),
    rows(sorted.slice(0, nearest)),
    sorted.length > nearest
      ? h(
          "details",
          { class: "more" },
          h("summary", null, `Още ${sorted.length - nearest}`),
          rows(sorted.slice(nearest)),
        )
      : null,
  ];
}

/** What unlocks something, as a sentence: „със“ before a word that starts with „с“ or „з“ („със скрито
 * постижение“). */
function unlockedWith(how: string): string {
  return `Отключва се ${/^[сз]/i.test(how) ? "със" : "с"} ${how}.`;
}

/** A locked thing's words: its name, what unlocks it, and how far along the player is — their level, or the
 * achievement's deed and progress (a hidden one only as hidden). */
function lockText(p: Progress, x: Lock & { name: string }): Child {
  const how = x.how ?? "";
  const a = x.achievement ? p.achievements.find((y) => y.id === x.achievement) : undefined;
  const goal = a?.goal ?? 1;
  return h(
    "div",
    { class: "achievement-text" },
    h("span", { class: "achievement-name" }, x.name),
    h("span", { class: "achievement-about" }, unlockedWith(how)),
    x.level ? h("span", { class: "achievement-when" }, `Сега си на ниво ${p.level}.`) : null,
    a ? h("span", { class: "achievement-when" }, a.about) : null,
    a && !a.hidden && goal > 1
      ? h(
          "span",
          { class: "achievement-progress" },
          meter(Math.round((100 * (a.progress ?? 0)) / goal), `${a.progress ?? 0} от ${goal}`),
          h("span", { class: "num" }, `${a.progress ?? 0} / ${goal}`),
        )
      : null,
  );
}

/** The titles: the player's own to wear, then, folded away, the locked ones by where they come from. */
function titles(p: Progress, set: (body: { title: string }) => void): Child {
  const locked = p.titles.filter((a) => a.locked);
  return [
    h(
      "ul",
      { class: "titles" },
      h(
        "li",
        null,
        h(
          "button",
          // Pressed only when chosen: a player who hasn't chosen wears their level's title as it comes.
          {
            class: "title-pick",
            type: "button",
            "aria-pressed": !p.title && !p.titleByLevel,
            onclick: () => set({ title: "" }),
          },
          h("span", { class: "title-name" }, "Без титла"),
        ),
      ),
      p.titles
        .filter((a) => !a.locked)
        .map((a) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                class: `title-pick t-${a.tier}`,
                type: "button",
                "aria-pressed": a.id === p.title,
                onclick: () => set({ title: a.id }),
              },
              h("span", { class: "title-name" }, a.name),
              h("span", { class: "title-tier" }, tierWords[a.tier].title),
            ),
          ),
        ),
    ),
    locked.length
      ? h(
          "details",
          { class: "more" },
          h("summary", null, `Още ${locked.length} за отключване`),
          titleGroups.map(([group, heading]) => {
            const list = locked.filter((a) => a.group === group);
            if (!list.length) return null;
            return [
              h("h3", { class: "titles-more" }, heading),
              h(
                "ul",
                { class: "titles" },
                list.map((a) =>
                  h(
                    "li",
                    { class: `title-pick locked t-${a.tier}` },
                    h("span", { class: "title-name" }, a.name),
                    h("span", { class: "title-tier" }, tierWords[a.tier].title),
                    h("span", { class: "title-how" }, unlockedWith(a.how ?? "")),
                  ),
                ),
              ),
            ];
          }),
        )
      : null,
  ];
}
