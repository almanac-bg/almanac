// Pages without page loads: links inside the app change the screen in place, and Back and Forward work as they should.

import { type Child, mount, signal } from "./dom.ts";

export interface Route {
  path: RegExp;
  view: (params: string[]) => Child;
}

/** The path shown now (for navigation to highlight where you are). */
export const path = signal(location.pathname);

let routes: Route[] = [];
let missing: () => Child = () => null;
let root: Element;
let disposeView: (() => void) | null = null;

export function start(target: Element, list: Route[], notFound: () => Child): void {
  root = target;
  routes = list;
  missing = notFound;
  addEventListener("popstate", () => render(false));
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a");
    if (
      !a ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      a.target ||
      a.hasAttribute("download") ||
      a.origin !== location.origin ||
      !routes.some((r) => r.path.test(a.pathname)) // a page of the server's own (/privacy)
    )
      return;
    e.preventDefault();
    go(a.pathname + a.search + a.hash);
  });
  render(false);
}

/** Opens a path in the app. */
export function go(to: string, replace = false): void {
  if (to === location.pathname + location.search + location.hash && !replace) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  render(true);
}

function render(scrollTop: boolean): void {
  path.set(location.pathname);
  let view: () => Child = missing;
  for (const r of routes) {
    const m = r.path.exec(location.pathname);
    if (m) {
      view = () => r.view(m.slice(1));
      break;
    }
  }
  disposeView?.();
  disposeView = mount(root, view);
  if (scrollTop) scrollTo(0, 0);
  // Screen readers start at the new screen's heading.
  const heading = root.querySelector<HTMLElement>("h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

/** Sets the tab's title for the screen. */
export function title(text?: string): void {
  document.title = text ? `${text} · АЛМАНАХ` : "АЛМАНАХ";
}
