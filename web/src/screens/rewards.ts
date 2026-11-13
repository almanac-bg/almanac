// Награди: what playing earns — the achievements by tier, each with how it's earned, and the wardrobe: the avatar's
// shape and tone, and the titles to wear.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import { avatar, badge, shapeNames, type Tier, tiers, tierWords, toneNames } from "../ui.ts";
import { loadProgress, type Progress } from "./progress.ts";

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

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

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
                h("span", { class: "achievement-when" }, a.at ? `Спечелено на ${day(a.at)}` : "Още не е спечелено"),
              ),
            ),
          ),
        ),
      );
    }),
  );
}

/** How you look to others: the avatar's shape and tone, and a title from your achievements. */
function look(progress: () => Progress | null, reload: () => Promise<void>): Child {
  const hint = signal("");
  const error = signal("");
  const set = async (body: { avatar?: string; title?: string }) => {
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
    // Every title, by tier: the earned ones to wear, the rest with what unlocks them.
    const titles = tiers.flatMap((t: Tier) => p.achievements.filter((a) => a.tier === t));
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
      h("h3", null, "Титла"),
      h("p", { class: "muted" }, "Титлата се вижда под името ти. Всяко постижение отключва една."),
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
        titles.map((a) =>
          h(
            "li",
            null,
            a.at
              ? h(
                  "button",
                  {
                    class: `title-pick t-${a.tier}`,
                    type: "button",
                    "aria-pressed": a.id === p.title,
                    onclick: () => set({ title: a.id }),
                  },
                  h("span", { class: "title-name" }, a.name),
                  h("span", { class: "title-tier" }, tierWords[a.tier].title),
                )
              : h(
                  "div",
                  { class: `title-pick locked t-${a.tier}` },
                  h("span", { class: "title-name" }, a.name),
                  h("span", { class: "title-tier" }, tierWords[a.tier].title),
                  h("span", { class: "title-how" }, `Отключва се: ${lower(a.about)}`),
                ),
          ),
        ),
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    );
  };
}

/** Your name (anyone's: names may repeat) and your tag (yours alone: how friends find you). */
