// Гардероб: how a player looks to others — the avatar (an animal or an emblem, in a colour), its frame and the pattern
// behind it, and the title under their name. What they wear now shows at the top as others see it; below, one group at
// a time, everything to choose from, the locked ones with what unlocks them.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import { avatar, profileNav, shapeNames, tierWords, toneNames } from "../ui.ts";
import { type Cosmetic, loadProgress, type Progress, type TitleView } from "./progress.ts";

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
  ["achievement", "С постиженията"],
  ["topic", "С майсторството в темите"],
  ["rank", "С рейтинга, Роял и сезоните"],
];

export function wardrobe() {
  title("Гардероб");
  return h(
    "section",
    { class: "screen" },
    () => (user() ? profileNav() : null),
    h("h1", null, "Гардероб"),
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
  const told = signal("");
  const error = signal("");
  const set = async (body: { avatar?: string; title?: string; frame?: string; backdrop?: string }) => {
    error.set("");
    told.set("");
    try {
      await api("PATCH", "/api/me/look", body);
      await reload();
    } catch (err) {
      error.set((err as ApiError).message);
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
            : h("span", { class: "muted" }, "Без титла"),
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
              onclick: () => {
                told.set("");
                part.set(id);
              },
            },
            text,
          ),
        ),
      ),
      () => {
        switch (part()) {
          case "avatar":
            return avatars(p, set, told);
          case "frame":
            return wear(
              p.frames,
              p.frame,
              "Без рамка",
              (id) => avatar(p.avatar, { frame: id, backdrop: p.backdrop }),
              (id) => set({ frame: id }),
              told,
            );
          case "backdrop":
            return wear(
              p.backdrops,
              p.backdrop,
              "Едноцветен",
              (id) => avatar(p.avatar, { frame: p.frame, backdrop: id }),
              (id) => set({ backdrop: id }),
              told,
            );
          case "title":
            return titles(p, set);
        }
      },
      () => told() && h("p", { class: "muted", role: "status" }, told()),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    ];
  };
}

/** The avatar: its picture (the animals, and the emblems achievements unlock), then its colour. */
function avatars(p: Progress, set: (body: { avatar: string }) => void, told: { set: (s: string) => void }): Child {
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
      p.shapes.map((s) =>
        h(
          "li",
          null,
          h(
            "button",
            {
              class: s.locked ? "pick locked" : "pick",
              type: "button",
              "aria-pressed": s.shape === shape,
              "aria-label": s.locked ? `${shapeNames[s.shape]}, заключено` : shapeNames[s.shape],
              onclick: () =>
                s.locked
                  ? told.set(
                      s.shape === "crown"
                        ? "Короната се отключва на ниво 10."
                        : `${shapeNames[s.shape]}: отключва се с постижението „${s.how}“.`,
                    )
                  : set({ avatar: `${s.shape}-${tone}` }),
            },
            avatar(`${s.shape}-${tone}`),
          ),
        ),
      ),
    ),
  ];
}

/** A frame or a pattern: each drawn on the player's avatar, the locked ones with what unlocks them. */
function wear(
  all: Cosmetic[],
  worn: string,
  none: string,
  preview: (id: string) => Child,
  put: (id: string) => void,
  told: { set: (s: string) => void },
): Child {
  return h(
    "ul",
    { class: "picker" },
    [{ id: "", name: none } as Cosmetic, ...all].map((c) =>
      h(
        "li",
        null,
        h(
          "button",
          {
            class: c.locked ? "pick locked" : "pick",
            type: "button",
            "aria-pressed": c.id === worn,
            "aria-label": c.locked ? `${c.name}, заключено` : c.name,
            onclick: () => (c.locked ? told.set(`${c.name}. Отключва се: ${c.how}.`) : put(c.id)),
          },
          preview(c.id),
        ),
      ),
    ),
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
          { class: "title-pick", type: "button", "aria-pressed": !p.title, onclick: () => set({ title: "" }) },
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
                    h("span", { class: "title-how" }, `Отключва се: ${a.how}`),
                  ),
                ),
              ),
            ];
          }),
        )
      : null,
  ];
}
