// Награди: what playing earns — the achievements by tier, each with how it's earned, and the wardrobe: the avatar's
// shape and tone, and the titles to wear.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import { avatar, badge, meter, shapeNames, tiers, tierWords, toneNames } from "../ui.ts";
import { type Cosmetic, loadProgress, type Progress, type TitleView } from "./progress.ts";

export function rewards() {
  title("Награди");
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Награди"),
    when(
      () => user(),
      () => {
        const progress = signal<Progress | null>(null);
        const load = () => loadProgress().then(progress.set, () => {});
        load();
        return [
          () => {
            const p = progress();
            return p ? achievements(p) : null;
          },
          h("div", { class: "settings" }, look(progress, load)),
        ];
      },
      () =>
        h(
          "p",
          { class: "lead" },
          "Постиженията, титлите и аватарите идват с играта. Изиграй първите си въпроси и ще ги видиш тук.",
        ),
    ),
  );
}

const day = (ms: number) => new Intl.DateTimeFormat("bg", { day: "numeric", month: "long" }).format(new Date(ms));

/** Every achievement, by tier: the earned ones bright, with the day; each with how it's earned. */
function achievements(p: Progress): Child {
  const earned = p.achievements.filter((a) => a.at).length;
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, `Постижения · ${earned} от ${p.achievements.length}`),
    tiers.map((tier) => {
      const list = p.achievements.filter((a) => a.tier === tier);
      if (!list.length) return null;
      return h(
        "section",
        { class: `tier t-${tier}` },
        h(
          "h3",
          { class: "tier-head" },
          tierWords[tier].group,
          h("span", { class: "muted" }, ` · ${list.filter((a) => a.at).length} от ${list.length}`),
        ),
        h(
          "ul",
          { class: "achievements" },
          list.map((a) =>
            h(
              "li",
              { class: a.at ? "achievement" : "achievement locked" },
              badge(a, !!a.at),
              h(
                "div",
                { class: "achievement-text" },
                h("span", { class: "achievement-name" }, a.name),
                h("span", { class: "achievement-about" }, a.about),
                !a.at && (a.goal ?? 1) > 1
                  ? h(
                      "span",
                      { class: "achievement-progress" },
                      meter(Math.round((100 * (a.progress ?? 0)) / (a.goal ?? 1)), `${a.progress ?? 0} от ${a.goal}`),
                      h("span", { class: "num" }, `${a.progress ?? 0} / ${a.goal}`),
                    )
                  : null,
                h(
                  "span",
                  { class: "achievement-when" },
                  a.at ? `Спечелено на ${day(a.at)}` : a.hidden ? "Скрито — открий го в игра" : "Още не е спечелено",
                ),
                h(
                  "span",
                  { class: "achievement-reward" },
                  h("span", {
                    class: `reward-mark av-${a.hidden && !a.at ? "secret" : a.icon}`,
                    "aria-hidden": "true",
                  }),
                  a.hidden && !a.at
                    ? "Награда: ще разбереш"
                    : `Награда: форма „${shapeNames[a.icon] ?? a.icon}“ за аватара${a.title ? ` и титла „${a.title.name}“` : ""}`,
                ),
              ),
            ),
          ),
        ),
      );
    }),
  );
}

/** The groups of titles still locked, as headed. */
const titleGroups: [TitleView["group"], string][] = [
  ["level", "С нивата"],
  ["achievement", "С постижения"],
  ["topic", "С майсторство в тема"],
  ["rank", "С рейтинга, Роял и сезона"],
];

/** How you look to others: the avatar's shape and tone, its frame and pattern, and a title. */
function look(progress: () => Progress | null, reload: () => Promise<void>): Child {
  const hint = signal("");
  const error = signal("");
  const set = async (body: { avatar?: string; title?: string; frame?: string; backdrop?: string }) => {
    error.set("");
    hint.set("");
    try {
      await api("PATCH", "/api/me/look", body);
      await reload();
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  return () => {
    const p = progress();
    if (!p) return null;
    const [shape = "", tone = ""] = p.avatar.split("-");
    return h(
      "section",
      null,
      h("h2", null, "Вид"),
      h("p", { class: "muted" }, "Аватарът ти е форма в цвят. Някои форми се отключват с постижения."),
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
                "aria-label": s.locked ? `${shapeNames[s.shape]}, заключена` : shapeNames[s.shape],
                onclick: () =>
                  s.locked
                    ? hint.set(
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
      () => hint() && h("p", { class: "muted", role: "status" }, hint()),
      h(
        "div",
        { class: "tones" },
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
      wear(
        "Рамка",
        p.frames,
        p.frame,
        "Без рамка",
        (id) => avatar(p.avatar, { frame: id, backdrop: p.backdrop }),
        (id) => set({ frame: id }),
      ),
      wear(
        "Фон",
        p.backdrops,
        p.backdrop,
        "Едноцветен",
        (id) => avatar(p.avatar, { frame: p.frame, backdrop: id }),
        (id) => set({ backdrop: id }),
      ),
      h("h3", null, "Титла"),
      h(
        "p",
        { class: "muted" },
        "Титлата се вижда под името ти. Отключват се с нивата, с някои постижения, с майсторство в тема и с рейтинга.",
      ),
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
      // The ones still locked, after, by where they come from: what each takes.
      titleGroups.map(([group, heading]) => {
        const locked = p.titles.filter((a) => a.locked && a.group === group);
        if (!locked.length) return null;
        return [
          h("h4", { class: "titles-more" }, heading),
          h(
            "ul",
            { class: "titles" },
            locked.map((a) =>
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
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    );
  };
}

/** Your name (anyone's: names may repeat) and your tag (yours alone: how friends find you). */

/** A row of the wardrobe (frames, or patterns): each drawn on the player's avatar, the locked ones with what
 * unlocks them. */
function wear(
  heading: string,
  all: Cosmetic[],
  worn: string,
  none: string,
  preview: (id: string) => Child,
  put: (id: string) => void,
): Child {
  const told = signal("");
  return [
    h("h3", null, heading),
    h(
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
              "aria-label": c.locked ? `${c.name}, заключена` : c.name,
              onclick: () => (c.locked ? told.set(`${c.name}: отключва се с ${c.how}.`) : put(c.id)),
            },
            preview(c.id),
          ),
        ),
      ),
    ),
    () => told() && h("p", { class: "muted", role: "status" }, told()),
  ];
}
