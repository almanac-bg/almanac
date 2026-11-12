// АЛМАНАХ's web client: the frame (header and tabs) and the screens the router puts in it.

import { h, mount } from "./lib/dom.ts";
import { path, start } from "./lib/router.ts";
import { me } from "./screens/me.ts";
import { missing } from "./screens/missing.ts";
import { play } from "./screens/play.ts";
import { today } from "./screens/today.ts";

const tabs: [href: string, label: string, match: (p: string) => boolean][] = [
  ["/", "Днес", (p) => p === "/"],
  ["/play", "Игра", (p) => p.startsWith("/play")],
  ["/me", "Профил", (p) => p === "/me"],
];

function frame() {
  const main = h("main", { id: "main" });
  const view = [
    h(
      "header",
      { class: "top" },
      h("a", { href: "/", class: "brand", "aria-label": "АЛМАНАХ, начало" }, mark(), h("span", null, "АЛМАНАХ")),
    ),
    main,
    h(
      "nav",
      { class: "tabs", "aria-label": "Основно" },
      tabs.map(([href, label, match]) =>
        h("a", { href, "aria-current": () => (match(path()) ? "page" : null) }, label),
      ),
    ),
  ];
  return { view, main };
}

/** The rosette: four answers, one of them right. */
function mark(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("mark");
  for (const [angle, cls] of [
    [-45, "petal right"],
    [45, "petal"],
    [135, "petal"],
    [225, "petal"],
  ] as const) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z");
    p.setAttribute("transform", `rotate(${angle} 32 32)`);
    p.setAttribute("class", cls);
    svg.append(p);
  }
  return svg;
}

const root = document.getElementById("app");
if (root) {
  const { view, main } = frame();
  mount(root, () => view);
  start(
    main,
    [
      { path: /^\/$/, view: today },
      { path: /^\/play$/, view: play },
      { path: /^\/me$/, view: me },
    ],
    missing,
  );
}
